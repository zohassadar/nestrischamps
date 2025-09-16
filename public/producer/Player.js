import QueryString from '/js/QueryString.js';
import BinaryFrame from '/js/BinaryFrame.js';
import Connection from '/js/connection.js';

import { peerServerOptions } from '/views/constants.js';

import { getSerializableConfigCopy } from './ConfigUtils.js';
import { supportsImageType } from './MediaUtils.js';

import GameTracker from './GameTracker.js';
import { createOCRInstance } from './ocrStrategy.js';

const SEND_BINARY = QueryString.get('binary') !== '0';
const HEART_BEAT_TIMEOUT = 1000;
const REMOTE_CALIBRATION_FRAME_INTERVAL_MS = 10000; // ms

async function getRemoteCalibrationImageArgs() {
	const IMAGE_TYPE_PRECEDENCE = [
		{ type: 'image/webp', quality: 0.5 },
		{ type: 'image/jpeg', quality: 0.8 },
	];

	for (const { type, quality } of Object.values(IMAGE_TYPE_PRECEDENCE)) {
		if (await supportsImageType(type)) return [type, quality];
	}

	return ['image/png'];
}

const remoteCalibrationImageArgsPromise = getRemoteCalibrationImageArgs(); // no await

export class Player extends EventTarget {
	#ready = false;
	#remoteCalibrationImageArgs;
	#startTime;
	#lastFrame;
	#connection = null;
	#peer;

	constructor(config, num = null) {
		super();

		this.num = num;
		this.config = config;

		this.#startTime = Date.now();
		this.#lastFrame = { field: [] };

		this.gameTracker = new GameTracker(config);
		this.gameTracker.addEventListener('frame', this.#handleFrame);

		this.is_player = false;
		this.notice = document.createElement('div');

		this.API = {
			message: msg => {
				this.dispatchEvent(
					new CustomEvent('chat_message', {
						detail: msg,
					})
				);
			},

			setViewPeerId: _view_peer_id => {
				this.view_peer_id = _view_peer_id;
			},

			makePlayer: (player_index, view_meta) => {
				this.is_player = true;
				this.view_meta = view_meta;
				this.dispatchEvent(
					new CustomEvent('make_player', {
						detail: { player_index, view_meta },
					})
				);
			},

			dropPlayer() {
				this.is_player = false;
				this.view_meta = null;
				this.dispatchEvent(new CustomEvent('drop_player'));
			},

			requestRemoteCalibration: async admin_peer_id => {
				console.log('requestRemoteCalibration', admin_peer_id);

				if (this.conn) {
					clearInterval(this.conn.sendVideoFrameIntervalId);
					this.conn.close();
				}

				const video = this._driver.getVideo();

				const remoteConfig = getSerializableConfigCopy(this.config);

				// strip out fields that should not be shared
				delete remoteConfig.device_id; // this should never be shared - device_id is specific to the local hardware and site

				this.conn = this.#peer.connect(admin_peer_id, {
					metadata: {
						video: {
							width: video.videoWidth,
							height: video.videoHeight,
						},
						config: remoteConfig,
						imageArgs: this.#remoteCalibrationImageArgs,
						userAgent: window.navigator.userAgent,
					},
				});

				const sendVideoFrame = async () => {
					console.log('sending remote calibration frame');
					const img = await this.#getVideoFrameAsImgBlob();
					this.conn.send({ img });
				};

				this.conn.on('open', () => {
					clearInterval(this.conn.sendVideoFrameIntervalId);
					this.conn.sendVideoFrameIntervalId = setInterval(
						sendVideoFrame,
						REMOTE_CALIBRATION_FRAME_INTERVAL_MS
					);
					sendVideoFrame();
				});

				this.conn.on('data', ({ config }) => {
					for (const [name, task] of Object.entries(config.tasks)) {
						this.config.tasks[name].dirty = true;
						Object.assign(this.config.tasks[name].crop, task.crop);
					}

					// TODO: how to update the controls?
					['brightness', 'contrast'].forEach(prop => {
						if (prop in config) {
							this.config[prop] = config[prop];
						}
					});

					// TODO: carry score7 and reset entire config

					this.config.save();

					this.dispatchEvent(
						new CustomEvent('remote_config_update', { detail: config })
					);
				});

				this.conn.on('close', () => {
					clearInterval(this.conn.sendVideoFrameIntervalId);
				});
			},

			setVdoNinjaURL: () => {},
		};

		// don't remove this, this.ocrPromise is used by the capture component T_T
		this.ocrPromise = createOCRInstance(config);

		// async init
		Promise.all([this.ocrPromise, remoteCalibrationImageArgsPromise]).then(
			([ocr, imageArgs]) => {
				this.#remoteCalibrationImageArgs = imageArgs;

				this.ocr = ocr;
				this.ocr.addEventListener('frame', ({ detail: frame }) => {
					this.gameTracker.processFrame(frame);
				});
				this.connect();
				this.#ready = true;
			}
		);
	}

	// manual async
	#getVideoFrameAsImgBlob() {
		const video = this._driver.getVideo();

		if (!this.remote_calibration_canvas) {
			// lazy initialization of the remote calibration canvas
			this.remote_calibration_canvas = document.createElement('canvas');
			this.remote_calibration_canvas.width = video.videoWidth;
			this.remote_calibration_canvas.height = video.videoHeight;
			this.remote_calibration_canvas_ctx =
				this.remote_calibration_canvas.getContext('2d', { alpha: false });
			this.remote_calibration_canvas_ctx.imageSmoothingEnabled = false;
		}

		// Draw the current video frame into the canvas
		this.remote_calibration_canvas_ctx.drawImage(
			video,
			0,
			0,
			this.remote_calibration_canvas.width,
			this.remote_calibration_canvas.height
		);

		// Convert to webp Blob at 50% quality
		return new Promise(resolve => {
			this.remote_calibration_canvas.toBlob(
				blob => resolve(blob),
				...this.#remoteCalibrationImageArgs
			);
		});
	}

	processVideoFrame(frame) {
		if (!this.#ready) return;

		return this.ocr.processVideoFrame(frame);
	}

	#handleFrame = ({ detail: data }) => {
		if (!this.#connection) return;

		data.game_type = this.config.game_type ?? BinaryFrame.GAME_TYPE.CLASSIC;
		data.ctime = Date.now() - this.#startTime;

		// delete data fields which are never meant to be sent over the wire
		delete data.color1;
		delete data.color2;
		delete data.color3;
		delete data.gym_pause_active;
		delete data.raw;

		// only send frame if changed
		check_equal: do {
			for (let key in data) {
				if (key == 'ctime') continue;
				if (key == 'field') {
					if (!data.field.every((v, i) => this.#lastFrame.field[i] === v)) {
						break check_equal;
					}
				} else if (data[key] != this.#lastFrame[key]) {
					break check_equal;
				}
			}

			// all fields equal, do a sanity check on time
			if (data.ctime - this.#lastFrame.ctime >= HEART_BEAT_TIMEOUT) break; // even if there's no change, send a "heartbeat frame" at least every HEART_BEAT_TIMEOUT ms

			// no need to send frame
			return;
		} while (false);

		this.#lastFrame = data;

		if (SEND_BINARY) {
			this.#connection?.send(BinaryFrame.encode(data));
		} else {
			// convert Uint8Array to normal array so it can be json-encoded properly
			data.field = [...data.field];
			this.#connection?.send(data);
		}
	};

	connect() {
		if (this.#connection) {
			this.#connection.close();
		}

		console.log('Creating Connection');

		if (this.num === null) {
			this.#connection = new Connection(
				null,
				new URLSearchParams({
					_remote_calibration: 1,
				})
			);
		} else {
			// multiviewer mode, we connect by static player secret
			const url = new URL(location);
			url.protocol = url.protocol.match(/^https/i) ? 'wss:' : 'ws:';
			url.pathname = `/ws${url.pathname}`.replace(
				/(\/+)?$/,
				`/PLAYER${this.num}`
			);

			console.log(`Using custom url: ${url.toString()}`);

			this.#connection = new Connection(
				url.toString(),
				new URLSearchParams({
					_remote_calibration: 1,
				})
			);
		}

		this.#connection.onMessage = frame => {
			try {
				const [method, ...args] = frame;

				if (this.API.hasOwnProperty(method)) {
					this.API[method](...args);
				} else {
					console.log(`Command ${method} received but not supported`);
				}
			} catch (e) {
				console.log(`Could not process command ${frame[0]}`);
				console.error(e);
			}
		};

		this.#connection.onKicked = reason => {
			this.resetNotice();
			this.notice.classList.add('error');
			this.notice.textContent = `WARNING! The connection has been kicked because [${reason}]. The page will NOT attempt to reconnect.`;
			this.notice.classList.remove('is-hidden');
		};

		this.#connection.onBreak = () => {
			this.resetNotice();
			this.notice.classList.add('warning');
			this.notice.textContent = `WARNING! The page is disconnected. It will try to reconnect automatically.`;
			this.notice.classList.remove('is-hidden');
		};

		this.#connection.onResume = this.resetNotice;

		this.#connection.onInit = () => {
			if (this.#peer) {
				this.#peer.removeAllListeners();
				this.#peer.destroy();
				this.#peer = null;
			}
			this.#peer = new Peer(this.#connection.id, peerServerOptions);
			this.#peer.on('open', err => {
				console.log(Date.now(), 'peer opened', this.#peer.id);
				this.dispatchEvent(new CustomEvent('peer_open'));
			});
			this.#peer.on('error', err => {
				console.log(`Peer error: ${err.message}`);
				this.#peer.retryTO = clearTimeout(this.#peer.retryTO); // there should only be one retry scheduled
				// this.#peer.retryTO = setTimeout(startSharingVideoFeed, 1500); // we assume this will succeed at some point?? 😰😅
			});
		};

		return this.#connection;
	}

	getPeer() {
		return this.#peer;
	}

	getViewPeerId() {
		return this.view_peer_id;
	}

	resetNotice = () => {};

	sendReady = (ready = false) => {
		this.#connection?.send(['setReady', !!ready]);
	};

	sendVdoNinjaUrl = url => {
		this.#connection?.send(['setVdoNinjaURL', url]);
	};
}
