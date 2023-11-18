// Request and report Data as-is
// Handle errors and reconnections

const EVERDRIVE_N8_PRO = { usbVendorId: 0x483, usbProductId: 0x5740 };
const EVERDRIVE_CMD_GET_STATUS = 0x10;
const EVERDRIVE_CMD_MEM_WR = 0x1a;
const EVERDRIVE_CMD_SEND_STATS = 0x42;
const EVERDRIVE_ADDR_FIFO = 0x1810000;
const GAME_FRAME_SIZE = 241;
const EVERDRIVE_TAIL = [0x00, 0xa5];
const GAME_FRAME_TAIL = [0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa];
const ED_MAX_READ_ATTEMPTS = 10;

function getEDCommandHeader(command) {
	// prettier-ignore
	return [
        '+'.charCodeAt(0),
        '+'.charCodeAt(0) ^ 0xff,
        command,
        command ^ 0xff
    ];
}

async function readInto(reader, dataArray) {
	let buffer = dataArray.buffer;
	let offset = 0;

	while (offset < buffer.byteLength) {
		// TODO: how to implement read timeout?
		const { value, done } = await reader.read(new Uint8Array(buffer, offset));
		if (done) {
			break;
		}
		buffer = value.buffer;
		offset += value.byteLength;
	}
	return new Uint8Array(buffer);
}

async function readUntilPattern(reader, dataArray, compare) {
	dataArray = await readInto(reader, dataArray);

	if (
		compare.every(
			(e, i) => e === dataArray[dataArray.length - compare.length + i]
		)
	) {
		return dataArray;
	}

	// flush the buffer, return an empty result
	while (true) {
		try {
			let { value, done } = await Promise.race([
				reader.read(new Uint8Array(GAME_FRAME_SIZE)),
				new Promise((_, reject) =>
					setTimeout(reject, 10, new Error('timeout'))
				),
			]);

			if (done) {
				console.log('Flushed value', value);
				break;
			}
		} catch (e) {
			console.error('Flushed Buffer');
		}
	}
}

export default class EDClient {
	constructor(frameRate) {
		this.frameDuration = 1000 / frameRate;
		this.requestFrameFromEverDrive = this.requestFrameFromEverDrive.bind(this);

		this.init();
	}

	async init() {
		this.everdrive = await this.getEverDrive();

		if (this.everdrive) {
			this.dataFrameBuffer = new Uint8Array(GAME_FRAME_SIZE);
			this.startTime = Date.now();
			this.requestFrameFromEverDrive();
		} else {
			// What to do?
		}
	}

	async getEverDrive() {
		const port = await this.getEDSerialPort();

		if (!port) {
			console.error('No ever drive not found');
			return;
		}

		try {
			await port.open({ baudRate: 115200, bufferSize: GAME_FRAME_SIZE }); // plenty of speed for 60fps data frame from gym are 240 bytes: 240x60=14400
		} catch (err) {
			console.warn(err);
			// assume port is already open for now
			// TODO: better error checking
		}

		const reader = port.readable.getReader({ mode: 'byob' });
		const writer = port.writable.getWriter();

		if (await this.verifyEDPort(reader, writer)) {
			return {
				port,
				reader,
				writer,
			};
		}
	}

	async getEDSerialPort() {
		let serialPort;

		const ports = await navigator.serial.getPorts();
		if (ports.length) {
			serialPort = ports.find(port => {
				const { usbProductId, usbVendorId } = port.getInfo();
				return (
					usbVendorId === EVERDRIVE_N8_PRO.usbVendorId &&
					usbProductId === EVERDRIVE_N8_PRO.usbProductId
				);
			});

			if (serialPort) return serialPort;
		}

		serialPort = await navigator.serial.requestPort({
			filters: [EVERDRIVE_N8_PRO],
		});

		if (serialPort) return serialPort;
	}

	async verifyEDPort(reader, writer) {
		// verify we have a real everdrive by sending a GET_STATUS command
		// (expecting [0x00, 0xA5] as response)
		const bytes = getEDCommandHeader(EVERDRIVE_CMD_GET_STATUS);

		let success = false;
		for (let attempt = ED_MAX_READ_ATTEMPTS; attempt--; ) {
			await writer.write(new Uint8Array(bytes));
			try {
				await readUntilPattern(reader, new Uint8Array(2), EVERDRIVE_TAIL);
				success = true;
				break;
			} catch (e) {
				console.error(`!Failed to read everdrive: ${e}`);
			}
		}

		if (!success) {
			console.error(`Max attempts ${ED_MAX_READ_ATTEMPTS} reached`);
			return false;
		}

		// restore the buffer for next use
		// data_frame_buffer = new Uint8Array(value.buffer);

		console.log('Everdrive verified!');
		return true;
	}

	async requestFrameFromEverDrive() {
		performance.mark('edlink_comm_start');

		// 0. prep request
		// ref: https://github.com/zohassadar/EDN8-PRO/blob/nestrischamps/edlink-n8/edlink-n8/Edio.cs#L622
		const bytes = [
			...getEDCommandHeader(EVERDRIVE_CMD_MEM_WR),

			// addr
			EVERDRIVE_ADDR_FIFO & 0xff,
			(EVERDRIVE_ADDR_FIFO >> 8) & 0xff,
			(EVERDRIVE_ADDR_FIFO >> 16) & 0xff,
			(EVERDRIVE_ADDR_FIFO >> 24) & 0xff,

			// len
			1,
			0,
			0,
			0,

			// exec
			0,

			EVERDRIVE_CMD_SEND_STATS,
		];

		// 1. send request
		const res = await this.everdrive.writer.write(new Uint8Array(bytes));

		performance.mark('edlink_write_end');

		// 2. read response
		try {
			// TODO: how to implement read timeout?
			this.dataFrameBuffer = await readUntilPattern(
				this.everdrive.reader,
				this.dataFrameBuffer,
				GAME_FRAME_TAIL
			);
		} catch (e) {
			console.error(`Error reading from everdrive: ${e}`);
		}

		performance.mark('edlink_read_end');

		try {
			this.onData(this.dataFrameBuffer);
		} catch (err) {
			console.error(err);
		}

		// can anything be done to be more precise?
		// shall we issue the next read immediatey and just wait till the game has processed the data?
		setTimeout(this.requestFrameFromEverDrive, 0);
	}

	onData() {}
}
