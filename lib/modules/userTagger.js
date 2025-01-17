/* @flow */

import $ from 'jquery';
import _ from 'lodash';
import { Module } from '../core/module';
import * as Options from '../core/options';
import {
	Alert,
	CreateElement,
	Thing,
	SelectedThing,
	downcast,
	isPageType,
	usernameSelector,
	getUsernameFromLink,
	loggedInUser,
	preventCloning,
	string,
	watchForElements,
	watchForThings,
	empty,
	watchForRedditEvents,
	isAppType,
} from '../utils';
import { Storage, openNewTabs, i18n } from '../environment';
import * as CommandLine from './commandLine';
import * as Dashboard from './dashboard';
import * as FilteReddit from './filteReddit';
import * as Hover from './hover';
import * as NightMode from './nightMode';
import * as Notifications from './notifications';

export const module: Module<*> = new Module('userTagger');

const bgToTextColorMap = {
	none: 'inherit',
	aqua: 'black',
	black: 'white',
	blue: 'white',
	cornflowerblue: 'white',
	fuchsia: 'white',
	gray: 'white',
	green: 'white',
	lime: 'black',
	maroon: 'white',
	navy: 'white',
	olive: 'white',
	orange: 'white',
	orangered: 'white',
	pink: 'black',
	purple: 'white',
	red: 'white',
	silver: 'black',
	teal: 'white',
	white: 'black',
	yellow: 'black',
};

module.moduleName = 'userTaggerName';
module.category = 'usersCategory';
module.description = 'userTaggerDesc';
module.options = {
	showTaggingIcon: {
		title: 'userTaggerShowTaggingIconTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerShowTaggingIconDesc',
	},
	storeSourceLink: {
		title: 'userTaggerStoreSourceLinkTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerStoreSourceLinkDesc',
		advanced: true,
	},
	useCommentsLinkAsSource: {
		title: 'userTaggerUseCommentsLinkAsSourceTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerUseCommentsLinkAsSourceDesc',
		advanced: true,
	},
	trackVoteWeight: {
		title: 'userTaggerTrackVoteWeightTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerTrackVoteWeightDesc',
		advanced: true,
	},
	vwNumber: {
		title: 'userTaggerVwNumberTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerVWNumberDesc',
		advanced: true,
		dependsOn: options => options.trackVoteWeight.value,
	},
	truncateTag: {
		title: 'userTaggerTruncateTagTitle',
		type: 'boolean',
		value: true,
		description: 'userTaggerTruncateTagDesc',
		advanced: true,
	},
	presetTags: {
		title: 'userTaggerPresetTagsTitle',
		type: 'table',
		addRowText: '+add preset',
		fields: [{
			key: 'text',
			name: 'text',
			type: 'text',
		}, {
			key: 'color',
			name: 'color',
			type: 'select',
			value: 'none',
			values: Object.entries(bgToTextColorMap).map(([k, v]) => ({
				name: k,
				value: k,
				style: `color: ${v}; background-color: ${k};`,
			})),
		}],
		value: ([]: Array<[string, string]>),
		description: 'userTaggerPresetTagsDesc',
		advanced: true,
	},
};

const tagStorage = Storage.wrapPrefix('tag.', () => (null: ?{|
	text?: string,
	link?: string,
	color?: string,
	votesDown?: number,
	votesUp?: number,
|}), user => user.toLowerCase(), true);

module.beforeLoad = () => {
	// Immediately load data in order to have it ready on mutation
	watchForThings(null, thing => {
		const user = thing.getAuthor();
		if (user) Tag.get(user);
	}, { immediate: true });

	watchForElements(['page', 'selfText'], usernameSelector, applyFromElement);

	watchForRedditEvents('postAuthor', (element, { author, _: { update } }) => {
		if (update) return;

		// Remove previously added tags, as Reddit may not empty the container when navigating posts
		for (const tag of element.getElementsByClassName('RESUserTag')) tag.remove();

		applyToUser(element, { username: author });
	});
	watchForRedditEvents('commentAuthor', (element, { author, _: { update } }) => {
		if (update) return;
		applyToUser(element, { username: author });
	});
	watchForRedditEvents('userHovercard', (element, { user: { username }, _: { update } }) => {
		if (update) return;
		applyToUser(element, { username, renderTaggingIcon: false });
	});
};

module.contentStart = () => {
	if (module.options.trackVoteWeight.value && loggedInUser()) {
		attachVoteHandler();
	}

	registerCommandLine();

	Dashboard.addTab('userTaggerContents', i18n('userTaggerMyUserTags'), module.moduleID, addDashboardFunctionality);
};

function applyFromElement(element) {
	const username = getUsernameFromLink(element);
	if (username) return applyToUser(element, { username });
}

export function applyToUser(element: HTMLElement, {
	username,
	renderTaggingIcon = module.options.showTaggingIcon.value && username !== loggedInUser(),
	renderVoteWeight = module.options.trackVoteWeight.value && username !== loggedInUser(),
}: {|
	username: string,
	renderTaggingIcon?: boolean,
	renderVoteWeight?: boolean,
|} = {}) {
	// Display tag immediately so that it can be rendered at once without having to wait for storage
	// since in most cases there's no applied tag
	const tag = Tag.getUnfilled(username);
	tag.add(element, { renderVoteWeight, renderTaggingIcon });
	tag.fill();
}

export const tags: Map<string, Tag> = new Map();

type RenderInstance = {|
	element: HTMLElement,
	tagger?: HTMLElement,
	vw?: HTMLElement,
	renderTaggingIcon?: boolean,
	renderVoteWeight?: boolean,
|};

export class Tag {
	static defaultTagElement = (e => () => e().cloneNode(true))(_.once(() => Tag.buildTagElement()));
	static buildTagElement({ text, color }: { text: ?string, color: ?string } = {}) {
		return string.html`
			<span class="RESUserTag">
				<a
					class="userTagLink ${(text || color) ? 'hasTag' : 'RESUserTagImage'} ${module.options.truncateTag.value ? 'truncateTag' : ''}"
					${(text || color) && string._html`style="background-color: ${color || 'none'}; color: ${bgToTextColorMap[color || 'none']} !important;"`}
					title="${text || 'set a tag'}"
					href="javascript:void 0"
				>${text || '\u00A0'/* nbsp */}</a>
			</span>
		`;
	}

	static async getStored(): Promise<Array<Tag>> {
		return Object.entries(await tagStorage.getAll())
			.map(([k, v]) => {
				const tag = Tag.getUnfilled(k);
				tag.load(v);
				return tag;
			});
	}

	static getUnfilled(id: string): Tag {
		let tag = tags.get(id);
		if (!tag) {
			tag = new Tag(id);
			tags.set(id, tag);
		}

		return tag;
	}

	static async get(id: string): Promise<Tag> {
		const tag = Tag.getUnfilled(id);
		await tag.fill();
		return tag;
	}

	id: string;
	text: ?string = null;
	link: ?string = null;
	color: ?string = null;
	votesUp: number = 0;
	votesDown: number = 0;

	get ignored(): boolean { return FilteReddit.listFilters.users.includesString(this.id); }

	instances: Array<RenderInstance> = [];

	constructor(id: $PropertyType<this, 'id'> = '~dummy') {
		this.id = id;
	}

	fill = _.once(async () => {
		const data = await tagStorage.get(this.id);
		if (data) {
			if (Object.keys(this.getBaseDifference(data)).length) {
				this.load(data);
			} else {
				this.delete();
			}
		}
	});

	load(data: *) {
		if (data.color !== undefined) this.color = data.color;
		else if (data.color === 'none' /* legacy value */) this.color = null;
		if (data.link !== undefined) this.link = data.link;
		if (data.text !== undefined) this.text = data.text;
		if (data.votesDown !== undefined) this.votesDown = data.votesDown;
		if (data.votesUp !== undefined) this.votesUp = data.votesUp;

		for (const instance of this.instances) this.render(instance);
	}

	extract() {
		return {
			color: this.color,
			link: this.link,
			text: this.text,
			votesDown: this.votesDown,
			votesUp: this.votesUp,
		};
	}

	save() {
		tagStorage.set(this.id, this.getBaseDifference());
	}

	getBaseDifference(data: * = this.extract()) {
		const base = (new Tag()).extract();
		return _.pickBy(data, (v, k) => base[k] !== v);
	}

	delete() {
		tagStorage.delete(this.id);
	}

	add(element: HTMLAnchorElement | HTMLElement, { renderTaggingIcon, renderVoteWeight }: {| renderTaggingIcon?: boolean, renderVoteWeight?: boolean |} = {}) {
		const instance: RenderInstance = this.instances.find(v => v.element === element) || { element };
		if (!this.instances.includes(instance)) this.instances.push(instance);
		if (renderTaggingIcon) instance.renderTaggingIcon = true;
		if (renderVoteWeight) instance.renderVoteWeight = true;
		this.render(instance);
	}

	get votes(): number {
		return this.votesUp - this.votesDown;
	}

	ignore({ showNotice = true }: { showNotice: boolean } = {}) {
		if (showNotice) {
			Notifications.showNotification({
				moduleID: module.moduleID,
				notificationID: 'addedToIgnoreList',
				message: `
					<p>Now ignoring content posted by ${this.id}.</p>
					${isPageType('inbox') ? `
						<p>If you wish to block ${this.id} from sending you messages, go to <a href="/message/messages/">your messages</a> and click 'block user' underneath their last message.</p>
						<p><a href="https://www.reddit.com/r/changelog/comments/ijfps/reddit_change_users_may_block_other_users_that/">About blocking users</a>.</p>
					` : ''}
				`,
				closeDelay: 5000,
			});
		}

		FilteReddit.listFilters.users.toggleString(this.id, true);
		if (!this.text) this.load({ text: 'ignored' });
		this.save();
	}

	unignore() {
		FilteReddit.listFilters.users.toggleString(this.id, false);
		if (this.text === 'ignored') this.load({ text: null });
		this.save();
	}

	openPrompt(instance: *) {
		if (this.link === null && module.options.storeSourceLink.value) {
			// since we haven't yet set a tag or a link for this user, auto populate a link for the
			// user based on where we are tagging from.
			this.link = getLinkBasedOnTagLocation(instance.element);
		}

		Hover.infocard('userTagger')
			.target(instance.tagger || instance.element)
			.options({ openDelay: 0, width: 350, closeOnMouseOut: false })
			.populateWith(card => populateDialog(this, card))
			.begin();
	}

	render(instance: *) {
		if (instance.vw) instance.vw.remove();
		if (instance.renderVoteWeight && (this.votesUp || this.votesDown)) {
			instance.vw = preventCloning(string.html`
				<a
					class="voteWeight"
					href="javascript:void 0"
					title="${i18n('userTaggerYourVotesFor', this.id, `+${this.votesUp} -${this.votesDown}`)}"
					style="${getVoteWeightStyle(this)}"
				>${module.options.vwNumber.value ? `[${this.votes > 0 ? '+' : ''}${this.votes}]` : '[vw]'}</a>
			`);
			instance.vw.addEventListener('click', () => this.openPrompt(instance));
			if (isAppType('d2x')) { // XXX: temp hack
				(instance.tagger || instance.element).appendChild(instance.vw);
			} else {
				(instance.tagger || instance.element).after(instance.vw);
			}
		}

		if (instance.tagger) instance.tagger.remove();
		if (this.text || this.color || instance.renderTaggingIcon) {
			// `defaultTagElement` is a lot fast than `buildTagElement`
			instance.tagger = preventCloning((this.text || this.color) ? Tag.buildTagElement(this) : Tag.defaultTagElement());
			instance.tagger.addEventListener('click', () => this.openPrompt(instance));
			if (isAppType('d2x')) { // XXX: temp hack
				instance.element.appendChild(instance.tagger);
			} else {
				instance.element.after(instance.tagger);
			}
		}
	}
}

function populateDialog(tag: Tag, card) {
	const head = string.html`<div class="userTagger-dialog-head">
		<span class="res-icon">&#xF0AC;</span>
		<span>${tag.id}</span>
		<span class="res-usertag-ignore"></span>
		</div>
	</div>`;

	const colors = Object.entries(bgToTextColorMap)
		.map(([color, textColor]) => ({
			textColor,
			color,
		}));

	const presetTags = module.options.presetTags.value;

	const body = string.html`
		<form id="userTaggerToolTip">
			<div class="fieldPair">
				<label class="fieldPair-label" for="userTaggerText">Text</label>
				<input class="fieldPair-text" type="text" id="userTaggerText" value="${tag.text}">
			</div>
			<div class="fieldPair">
				<label class="fieldPair-label" for="userTaggerColor">Color</label>
				<select id="userTaggerColor">
					${colors.map(({ textColor, color }) => string._html`
						<option style="color: ${textColor}; background-color: ${color}" value="${color}" ${tag.color === color && string._html`selected`}>${color}</option>
					`)}
				</select>
			</div>
			<div class="fieldPair" style="flex-wrap: wrap">
				<label class="fieldPair-label" for="userTaggerPreview">Preview</label>
				<span id="userTaggerPreview"></span>
				<a id="userTaggerPresetSaveAs" title="save as preset" href="javascript:void 0">save as preset</a>
			</div>
			<div class="fieldPair">
				<label class="fieldPair-label" for="userTaggerLink">
					<span class="userTaggerOpenLink">
						<a title="open link" href="javascript:void 0">Source URL</a>
					</span>
				</label>
				<input class="fieldPair-text" type="text" id="userTaggerLink" value="${tag.link}">
			</div>
			<div class="fieldPair">
				<label class="fieldPair-label" for="userTaggerVotesUp" title="Upvotes you have given this redditor">Upvotes</label>
				<input type="number" style="width: 50px;" id="userTaggerVotesUp" value="${tag.votesUp}">
			</div>
			<div class="fieldPair">
				<label class="fieldPair-label" for="userTaggerVotesDown" title="Downvotes you have given this redditor">Downvotes</label>
				<input type="number" style="width: 50px;" id="userTaggerVotesDown" value="${tag.votesDown}">
			</div>
			<div class="fieldPair" ${!presetTags.length && 'hidden'}>
				<label class="fieldPair-label" for="userTaggerPresetTags">Presets</label>
				<span id="userTaggerPresetTags"></span>
			</div>
			<div class="res-usertagger-footer">
				<a href="/r/dashboard#userTaggerContents" target="_blank" rel="noopener noreferer">View tagged users</a>
				<input type="submit" id="userTaggerSave" value="✓ save tag">
			</div>
		</form>
	`;

	const elements = {
		color: downcast(body.querySelector('#userTaggerColor'), HTMLSelectElement),
		presetSaveAs: downcast(body.querySelector('#userTaggerPresetSaveAs'), HTMLAnchorElement),
		presetTag: downcast(body.querySelector('#userTaggerPresetTags'), HTMLElement),
		presetFieldPair: downcast(body.querySelector('#userTaggerPresetTags').parentElement, HTMLElement),
		link: downcast(body.querySelector('#userTaggerLink'), HTMLInputElement),
		openLink: downcast(body.querySelector('.userTaggerOpenLink a'), HTMLAnchorElement),
		preview: downcast(body.querySelector('#userTaggerPreview'), HTMLElement),
		save: downcast(body.querySelector('#userTaggerSave'), HTMLElement),
		text: downcast(body.querySelector('#userTaggerText'), HTMLInputElement),
		votesDown: downcast(body.querySelector('#userTaggerVotesDown'), HTMLInputElement),
		votesUp: downcast(body.querySelector('#userTaggerVotesUp'), HTMLInputElement),
	};

	head.querySelector('.res-usertag-ignore').append(
		CreateElement.toggleButton(
			ignore => {
				const textShouldBeUpdated = extract().text === tag.text; // Override text only if not manually changed
				if (ignore) tag.ignore(); else tag.unignore();
				if (textShouldBeUpdated) elements.text.value = tag.text || '';
				updateTagPreview();
			},
			'userTaggerIgnore',
			tag.ignored,
			'\uF038' /* ignored */,
			'\uF03B' /* normal */,
			false,
			true
		)
	);

	function extract() {
		return {
			color: elements.color.value !== 'none' ? elements.color.value : null,
			link: elements.link.value || null,
			text: elements.text.value || null,
			votesDown: parseInt(elements.votesDown.value, 10) || 0,
			votesUp: parseInt(elements.votesUp.value, 10) || 0,
		};
	}

	function updateTagPreview() {
		empty(elements.preview);
		elements.preview.appendChild(Tag.buildTagElement(extract()));
	}

	function buildPresetTagElement(text: ?string, color: ?string) {
		const element = Tag.buildTagElement({ text, color });
		element.addEventListener('click', () => {
			tag.load({ text, color });
			tag.save();
			card.close();
		});
		return element;
	}

	function saveAsPreset() {
		const { text, color } = extract();
		if (text || color) {
			elements.presetFieldPair.hidden = false;
			elements.presetTag.append(buildPresetTagElement(text, color));
			module.options.presetTags.value.push([String(text), String(color)]);
			Options.save(module.options.presetTags);
		} else {
			window.alert('Tag text must be specified in order to save as preset.');
		}
	}

	elements.openLink.addEventListener('click', () => openNewTabs('none', ...elements.link.value.split(/\s/)));
	elements.presetTag.append(...presetTags.map(([text, color]) => buildPresetTagElement(text, color)));
	elements.presetSaveAs.addEventListener('click', () => saveAsPreset());

	$(body).on('change input click', updateTagPreview);
	body.addEventListener('submit', e => {
		e.preventDefault();
		tag.load(extract());
		tag.save();
		card.close();
	});

	updateTagPreview();
	setTimeout(() => {
		elements.text.setSelectionRange(elements.text.value.length, elements.text.value.length);
		elements.text.focus();
	});

	return [head, body];
}

function registerCommandLine() {
	let tag;

	CommandLine.registerCommand('tag', `tag [text] - ${i18n('userTaggerCommandLineDescription')}`,
		async (command, val) => {
			const username = SelectedThing.current && SelectedThing.current.getAuthor();
			tag = username && await Tag.get(username);
			return tag ?
				i18n(val ? 'userTaggerTagUserAs' : 'userTaggerTagUser', tag.id, val) :
				i18n('userTaggerTagCanNotSetTag');
		},
		(command, val) => {
			if (tag) {
				tag.load({ text: val });
				tag.save();
			} else {
				return i18n('userTaggerTagCanNotSetTag');
			}
		}
	);
}

function attachVoteHandler() {
	// hand-rolled delegated listener because jQuery doesn't support useCapture
	// which is necessary so we run before reddit's handler
	document.body.addEventListener('click', (e: MouseEvent) => {
		if (e.button !== 0) return;
		if (e.target.classList.contains('arrow')) {
			handleVoteClick(e.target);
		}
	}, true);
}

async function handleVoteClick(arrow) {
	const $this = $(arrow);
	const $otherArrow = $this.siblings('.arrow');

	// Stop if the post is archived (unvotable)
	if ($this.hasClass('archived')) {
		return;
	}

	// there are 6 possibilities here:
	// 1) no vote yet, click upmod
	// 2) no vote yet, click downmod
	// 3) already upmodded, undoing
	// 4) already downmodded, undoing
	// 5) upmodded before, switching to downmod
	// 6) downmodded before, switching to upmod

	// classes are changed AFTER this event is triggered
	let up = 0;
	let down = 0;
	if ($this.hasClass('up')) {
		// adding an upvote
		up = 1;
		if ($otherArrow.hasClass('downmod')) {
			// also removing a downvote
			down = -1;
		}
	} else if ($this.hasClass('upmod')) {
		// removing an upvote directly
		up = -1;
	} else if ($this.hasClass('down')) {
		// adding a downvote
		down = 1;
		if ($otherArrow.hasClass('upmod')) {
			// also removing an upvote
			up = -1;
		}
	} else if ($this.hasClass('downmod')) {
		// removing a downvote directly
		down = -1;
	}

	// must load tag object _after_ checking the DOM, so that classes will not be changed
	const thing = Thing.checkedFrom(arrow);
	const username = thing.getAuthor();

	// ignore votes for self
	if (username === loggedInUser()) return;

	const tag = username && await Tag.get(username);
	if (!tag) throw new Error('No tag');
	tag.load({
		votesUp: tag.votesUp + up,
		votesDown: tag.votesDown + down,
	});
	tag.save();
}

function getLinkBasedOnTagLocation(obj) {
	const thing = Thing.from(obj);
	if (!thing) return '';
	const link = !module.options.useCommentsLinkAsSource.value && thing.getTitleElement() ||
    thing.getCommentPermalink();
	return link ? link.href : '';
}

function getVoteWeightStyle({ votes, votesUp, votesDown }) {
	let red = 255;
	let green = 255;
	let blue = 255;
	let alpha = 1;
	if (votesUp > votesDown) {
		red = Math.max(0, 255 - 8 * votes);
		green = 255;
		blue = Math.max(0, 255 - 8 * votes);
		alpha = Math.abs(votes) / (votesUp + votesDown);
	} else if (votesUp < votesDown) {
		red = 255;
		green = Math.max(0, (255 - Math.abs(8 * votes)));
		blue = Math.max(0, (255 - Math.abs(8 * votes)));
		alpha = Math.abs(votes) / (votesUp + votesDown);
	}

	const color = `rgba(${red}, ${green}, ${blue}, ${0.2 + alpha * 0.8})`;
	return NightMode.isNightModeOn() ?
		`color: ${color};` :
		`background-color: ${color};`;
}

const filters = [
	{ get name() { return i18n('userTaggerAllUsers'); }, filter: v => v },
	{ get name() { return i18n('userTaggerTaggedUsers'); }, filter: v => v.text },
];

async function addDashboardFunctionality($tabPage) {
	// populate the contents of the tab
	const $showDiv = $(string.html`<div class="show">${i18n('userTaggerShow')} </div>`)
		.appendTo($tabPage);

	const tags = await Tag.getStored();
	$(string.html`
		<select id="tagFilter">
			${filters.map(({ name, filter }, i) => string._html`<option value="${i}" ${tags.some(filter) && 'selected'}>${name}</option>`)}
		</select>
	`)
		.change(() => drawUserTagTable())
		.appendTo($showDiv);

	const tagsPerPage = parseInt(Dashboard.module.options.tagsPerPage.value, 10);
	if (tagsPerPage) {
		const controlWrapper = document.createElement('div');
		controlWrapper.id = 'tagPageControls';
		$(controlWrapper).data({
			page: 1,
			pageCount: 1,
		});

		const leftButton = document.createElement('a');
		leftButton.className = 'res-step noKeyNav';
		leftButton.addEventListener('click', () => {
			const { page, pageCount } = $(controlWrapper).data();
			if (page === 1) {
				$(controlWrapper).data('page', pageCount);
			} else {
				$(controlWrapper).data('page', page - 1);
			}
			drawUserTagTable();
		});
		$(controlWrapper).append(string.escape`${i18n('userTaggerPage')} `);
		controlWrapper.appendChild(leftButton);

		const posLabel = document.createElement('span');
		posLabel.className = 'res-step-progress';
		posLabel.textContent = '1 of 2';
		controlWrapper.appendChild(posLabel);

		const rightButton = document.createElement('a');
		rightButton.className = 'res-step res-step-reverse noKeyNav';
		rightButton.addEventListener('click', () => {
			const { page, pageCount } = $(controlWrapper).data();
			if (page === pageCount) {
				$(controlWrapper).data('page', 1);
			} else {
				$(controlWrapper).data('page', page + 1);
			}
			drawUserTagTable();
		});
		controlWrapper.appendChild(rightButton);

		$tabPage.append(controlWrapper);
	}
	const $thisTable = $(string.html`
		<table id="userTaggerTable">
			<thead>
				<tr>
					<th sort="username" class="active">${i18n('userTaggerUsername')}<span class="sortAsc"></span></th>
					<th sort="tag">${i18n('userTaggerTag')}</th>
					<th sort="color">${i18n('userTaggerColor')}</th>
					<th sort="votesDown">${i18n('userTaggerVotesDown')}</th>
					<th sort="votesUp">${i18n('userTaggerVotesUp')}</th>
				</tr>
			</thead>
			<tbody></tbody>
		</table>
	`);

	$tabPage.append($thisTable);
	$('#userTaggerTable thead th').click(function(e) {
		e.preventDefault();
		const $this = $(this);

		if ($this.hasClass('delete')) {
			return false;
		}
		if ($this.hasClass('active')) {
			$this.toggleClass('descending');
		}
		$this.addClass('active');
		$this.siblings().removeClass('active').find('SPAN').remove();
		$this.find('.sortAsc, .sortDesc').remove();
		$this.append($(e.target).hasClass('descending') ?
			'<span class="sortDesc" />' :
			'<span class="sortAsc" />');
		drawUserTagTable($(e.target).attr('sort'), $(e.target).hasClass('descending'));
	});
	drawUserTagTable();
}

let currentSortMethod, isDescending;

async function drawUserTagTable(sortMethod, descending) {
	currentSortMethod = sortMethod || currentSortMethod;
	isDescending = (descending === undefined || descending === null) ? isDescending : descending;

	const tags = (await Tag.getStored())
		.filter(filters[$('#tagFilter').val()].filter);

	switch (currentSortMethod) {
		case 'tag':
			tags.sort((a, b) => (a.text || '').localeCompare(b.text || ''));
			break;
		case 'color':
			tags.sort((a, b) => (a.color || '').localeCompare(b.color || ''));
			break;
		case 'votesDown':
			tags.sort((a, b) => a.votesDown - b.votesDown);
			break;
		case 'votesUp':
			tags.sort((a, b) => a.votesUp - b.votesUp);
			break;
		case 'username':
			/* falls through */
		default:
			// sort users, ignoring case
			tags.sort((a, b) => a.id.localeCompare(b.id));
			break;
	}

	if (isDescending) {
		tags.reverse();
	}

	$('#userTaggerTable tbody').html('');
	const tagsPerPage = parseInt(Dashboard.module.options.tagsPerPage.value, 10);
	const count = tags.length;
	let start = 0;
	let end = count;

	if (tagsPerPage) {
		const $tagControls = $('#tagPageControls');
		let page = $tagControls.data('page');
		const pages = Math.ceil(count / tagsPerPage);
		page = Math.min(page, pages);
		page = Math.max(page, 1);
		$tagControls.data('page', page).data('pageCount', pages);
		$tagControls.find('.res-step-progress').text(i18n('userTaggerPageXOfY', page, pages));
		start = tagsPerPage * (page - 1);
		end = Math.min(count, tagsPerPage * page);
	}

	tags
		.slice(start, end)
		.forEach(tag => {
			const d = $(`
				<tr>
					<td>
						<span class="res-icon res-right deleteIcon" data-icon="&#xf056;" user="${tag.id}"></span>
						<a href="/user/${tag.id}">${tag.id}</a>
					</td>
					<td><a class="author" hidden></a></td>
					<td><span style="color: ${tag.color || 'initial'}">${tag.color ? tag.color : ''}</span></td>
					<td>${tag.votesDown}</td>
					<td>${tag.votesUp}</td>
				</tr>
			`).get(0);

			tag.add(downcast(d.querySelector('.author'), HTMLAnchorElement), { renderTaggingIcon: true });

			$('#userTaggerTable tbody').append(d);
		});
	$('#userTaggerTable tbody .deleteIcon').click(async function() {
		const tag = await Tag.get(this.getAttribute('user'));
		Alert.open(i18n('userTaggerAreYouSureYouWantToDeleteTag', tag.id), { cancelable: true })
			.then(() => {
				tag.delete();
				this.closest('tr').remove();
			});
	});
}
