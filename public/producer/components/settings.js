import QueryString from '/js/QueryString.js';
import { NtcComponent } from './NtcComponent.js';
import { html } from '../StringUtils.js';
import { clearConfigAndReset } from '../ConfigUtils.js';

import './camera.js';

const MARKUP = html`
	<div id="inputs" class="columns container is-fluid">
		<div class="column">
			<fieldset id="controls">
				<legend>Controls</legend>

				<div class="field">
					<button id="clear_config" class="button is-light">
						Clear Config and Restart
					</button>
				</div>

				<div class="field">
					<button id="save_game_palette" class="button is-light" disabled>
						Save Last Game's Palette
					</button>
				</div>

				<div id="timer_control" class="field is-hidden">
					<button id="start_timer" class="button">Start Timer</button>
					for
					<input type="number" id="minutes" value="120" min="5" max="5949" />
					minutes
				</div>

				<div
					id="multiviewer_notice"
					class="notification is-info is-light is-hidden mt-4"
				>
					Looking for multiviewer capture mode?
					<a id="multiviewer_href" href="#">Click here</a>.
				</div>
			</fieldset>
		</div>

		<ntc-camera id="camera" class="column"></ntc-camera>
	</div>
`;

const cssOverride = new CSSStyleSheet();
cssOverride.replaceSync(`
	.column {
		padding: 0;
	}
		
	#vdoninja_iframe {
		width: 100%;
		height: 30em;
	}
`);

export class NTC_Producer_Settings extends NtcComponent {
	#domrefs;

	constructor() {
		super();

		this._bulmaSheets.then(() => {
			this.shadow.adoptedStyleSheets.push(cssOverride);
		});

		this.shadow.innerHTML = MARKUP;
		this.style.display = 'block';

		this.#domrefs = {
			clear_config: this.shadow.getElementById('clear_config'),
			save_game_palette: this.shadow.getElementById('save_game_palette'),
			timer_control: this.shadow.getElementById('timer_control'),
			start_timer: this.shadow.getElementById('start_timer'),
			camera: this.shadow.getElementById('camera'),
			multiviewer_notice: this.shadow.getElementById('multiviewer_notice'),
			multiviewer_href: this.shadow.getElementById('multiviewer_href'),
		};

		this.#domrefs.clear_config.addEventListener('click', clearConfigAndReset);

		if (QueryString.get('timer') === '1') {
			this.#domrefs.timer_control.classList.remove('is_hidden');
		}

		const is_match_room = new URL(location).pathname.startsWith('/room/u/');
		if (!is_match_room) {
			fetch('/api/is_public_server')
				.then(res => res.json())
				.then(({ is_public_server, login }) => {
					if (!is_public_server && login) {
						this.#domrefs.multiviewer_href.href = `/room/u/${encodeURIComponent(login)}/producer${location.search}`;
						this.#domrefs.multiviewer_notice.classList.remove('is-hidden');
					}
				})
				.catch(err => {
					console.error('Failed to check server status', err);
				});
		}
	}

	async setPlayer(player) {
		this.#domrefs.camera.setPlayer(player);
	}
}

customElements.define('ntc-settings', NTC_Producer_Settings);
