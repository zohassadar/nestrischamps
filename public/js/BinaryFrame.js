const FORMAT_VERSION = 3;

const FRAME_SIZE_BY_VERSION = {
	1: 71,
	2: 72,
	3: 73,
};

const GAME_TYPE = {
	MINIMAL: 0,
	CLASSIC: 1,
	DAS_TRAINER: 2,
};

const PIECE_TO_VALUE = {
	T: 0,
	J: 1,
	Z: 2,
	O: 3,
	S: 4,
	L: 5,
	I: 6,
};

const VALUE_TO_PIECE = {
	0: 'T',
	1: 'J',
	2: 'Z',
	3: 'O',
	4: 'S',
	5: 'L',
	6: 'I',
};

const PIECES = Object.keys(PIECE_TO_VALUE);

const NULLABLE_FIELDS = [
	'score',
	'lines',
	'level',
	'instant_das',
	'cur_piece_das',
	...PIECES,
];

const POSSIBLE_RIGHT_PADDING = 50 /* field */ + 1; /* null terminator */

export default class BinaryFrame {
	static encode(pojo) {
		// TODO: validate pojo fields
		// TODO: throw if values are not compatible with format

		// sanitize values to represent null
		const sanitized = { ...pojo };

		NULLABLE_FIELDS.forEach(field => {
			// capture null and undefined on purpose
			if (sanitized[field] == null) {
				sanitized[field] = 0xffffffff;
			}
		});

		if (sanitized.preview == null) {
			sanitized.preview = 0xffffffff;
		} else {
			sanitized.preview = PIECE_TO_VALUE[sanitized.preview];
		}

		if (sanitized.cur_piece == null) {
			sanitized.cur_piece = 0xffffffff;
		} else {
			sanitized.cur_piece = PIECE_TO_VALUE[sanitized.cur_piece];
		}

		if (sanitized.field == null) {
			sanitized.field = Array(200).fill(0);
		}

		// fields are now clean, encode!

		const buffer = new Uint8Array(FRAME_SIZE_BY_VERSION[FORMAT_VERSION]);

		let bidx = 0; // byte index

		// header
		buffer[bidx++] =
			((FORMAT_VERSION & 0b111) << 5) | ((sanitized.game_type & 0b11) << 3);

		// gameid - 16 bits
		buffer[bidx++] = (sanitized.gameid & 0xff00) >> 8;
		buffer[bidx++] = (sanitized.gameid & 0x00ff) >> 0;

		// ctime - 28 bits
		buffer[bidx++] = (sanitized.ctime & 0xff00000) >> 20;
		buffer[bidx++] = (sanitized.ctime & 0x00ff000) >> 12;
		buffer[bidx++] = (sanitized.ctime & 0x0000ff0) >> 4;
		buffer[bidx++] =
			((sanitized.ctime & 0x0f) << 4) | ((sanitized.lines & 0xf00) >> 8);

		// lines - 12 bits
		buffer[bidx++] = sanitized.lines & 0xff;

		// level - 8 bits
		buffer[bidx++] = sanitized.level & 0xff;

		// score - 24 bits
		buffer[bidx++] = (sanitized.score & 0xff0000) >> 16;
		buffer[bidx++] = (sanitized.score & 0x00ff00) >> 8;
		buffer[bidx++] = (sanitized.score & 0x0000ff);

		// instant_das (5) + preview (3)
		buffer[bidx++] =
			((sanitized.instant_das & 0b11111) << 3) | (sanitized.preview & 0b111);

		// cur piece das (5) + cur piece (3)
		buffer[bidx++] =
			((sanitized.cur_piece_das & 0b11111) << 3) |
			(sanitized.cur_piece & 0b111);

		// piece stats (10 bits each)
		buffer[bidx++] = ((sanitized.T & 0b1111111100) >> 2);
		buffer[bidx++] = ((sanitized.T & 0b0000000011) << 6) | ((sanitized.J & 0b1111110000) >> 4);
		buffer[bidx++] = ((sanitized.J & 0b0000001111) << 4) | ((sanitized.Z & 0b1111000000) >> 6);
		buffer[bidx++] = ((sanitized.Z & 0b0000111111) << 2) | ((sanitized.O & 0b1100000000) >> 8);
		buffer[bidx++] = ((sanitized.O & 0b0011111111) << 0);

		buffer[bidx++] = ((sanitized.S & 0b1111111100) >> 2);
		buffer[bidx++] = ((sanitized.S & 0b0000000011) << 6) | ((sanitized.L & 0b1111110000) >> 4);
		buffer[bidx++] = ((sanitized.L & 0b0000001111) << 4) | ((sanitized.I & 0b1111000000) >> 6);
		buffer[bidx++] = ((sanitized.I & 0b0000111111) << 2);

		// 2 wasted bits here

		// field
		for (
			let block_idx = 0;
			block_idx < sanitized.field.length;
			block_idx += 4
		) {
			buffer[bidx++] =
				((sanitized.field[block_idx + 0] & 0b11) << 6) |
				((sanitized.field[block_idx + 1] & 0b11) << 4) |
				((sanitized.field[block_idx + 2] & 0b11) << 2) |
				((sanitized.field[block_idx + 3] & 0b11) << 0);
		}

		return buffer;
	}

	static parse(buffer_or_uintarray) {
		const f = BinaryFrame.getFrameFromBuffer(buffer_or_uintarray); // may throw

		const pojo = {};

		let bidx = 0;

		pojo.version = (f[bidx] & 0b11100000) >> 5;
		pojo.game_type = (f[bidx] & 0b11000) >> 3;
		pojo.player_num = f[bidx++] & 0b111;

		pojo.gameid = (f[bidx++] << 8) | f[bidx++];

		pojo.ctime =
			(f[bidx++] << 20) |
			(f[bidx++] << 12) |
			(f[bidx++] << 4) |
			((f[bidx] & 0xf0) >> 4);

		if (pojo.version >= 2) {
			pojo.lines = ((f[bidx++] & 0x0f) << 8) | f[bidx++];

			pojo.level = f[bidx++];

			pojo.score = (f[bidx++] << 16) | (f[bidx++] << 8) | f[bidx++];

			pojo.instant_das = (f[bidx] & 0b11111000) >> 3;
			pojo.preview = f[bidx++] & 0b111;

			pojo.cur_piece_das = (f[bidx] & 0b11111000) >> 3;
			pojo.cur_piece = f[bidx++] & 0b111;

			// piece stats
			if (pojo.version === 3) { // v3 - 10 bits per field
				pojo.T = ((f[bidx++] & 0b11111111) << 2) | ((f[bidx] & 0b11000000) >> 6);
				pojo.J = ((f[bidx++] & 0b00111111) << 4) | ((f[bidx] & 0b11110000) >> 4);
				pojo.Z = ((f[bidx++] & 0b00001111) << 6) | ((f[bidx] & 0b11111100) >> 2);
				pojo.O = ((f[bidx++] & 0b00000011) << 8) | ((f[bidx] & 0b11111111) >> 0);
				bidx++;
				pojo.S = ((f[bidx++] & 0b11111111) << 2) | ((f[bidx] & 0b11000000) >> 6);
				pojo.L = ((f[bidx++] & 0b00111111) << 4) | ((f[bidx] & 0b11110000) >> 4);
				pojo.I = ((f[bidx++] & 0b00001111) << 6) | ((f[bidx] & 0b11111100) >> 2);
			}
			else { // v2 - 9 bits per field
				pojo.T = ((f[bidx++] & 0b11111111) << 1) | ((f[bidx] & 0b10000000) >> 7);
				pojo.J = ((f[bidx++] & 0b01111111) << 2) | ((f[bidx] & 0b11000000) >> 6);
				pojo.Z = ((f[bidx++] & 0b00111111) << 3) | ((f[bidx] & 0b11100000) >> 5);
				pojo.O = ((f[bidx++] & 0b00011111) << 4) | ((f[bidx] & 0b11110000) >> 4);
				pojo.S = ((f[bidx++] & 0b00001111) << 5) | ((f[bidx] & 0b11111000) >> 3);
				pojo.L = ((f[bidx++] & 0b00000111) << 6) | ((f[bidx] & 0b11111100) >> 2);
				pojo.I = ((f[bidx++] & 0b00000011) << 7) | ((f[bidx] & 0b11111110) >> 1);
			}

			bidx++;
		} else {
			// version 1
			pojo.score =
				((f[bidx++] & 0x0f) << 17) |
				(f[bidx++] << 9) |
				(f[bidx++] << 1) |
				((f[bidx] & 0b10000000) >> 7);

			pojo.lines =
				((f[bidx++] & 0b01111111) << 2) | ((f[bidx] & 0b11000000) >> 6);

			pojo.level = f[bidx++] & 0b0111111;

			pojo.instant_das = (f[bidx] & 0b11111000) >> 3;
			pojo.preview = f[bidx++] & 0b111;

			pojo.cur_piece_das = (f[bidx] & 0b11111000) >> 3;
			pojo.cur_piece = f[bidx++] & 0b111;

			// piece stats
			pojo.T = f[bidx++];
			pojo.J = f[bidx++];
			pojo.Z = f[bidx++];
			pojo.O = f[bidx++];
			pojo.S = f[bidx++];
			pojo.L = f[bidx++];
			pojo.I = f[bidx++];
		}

		pojo.field = Array(200);

		for (let idx = 0; idx < 50; idx++, bidx++) {
			pojo.field[idx * 4 + 0] = (f[bidx] & 0b11000000) >> 6;
			pojo.field[idx * 4 + 1] = (f[bidx] & 0b00110000) >> 4;
			pojo.field[idx * 4 + 2] = (f[bidx] & 0b00001100) >> 2;
			pojo.field[idx * 4 + 3] = (f[bidx] & 0b00000011) >> 0;
		}

		// we've extracted all the value, now checks for nulls

		if (pojo.version >= 2) {
			if (pojo.score === 0xffffff) pojo.score = null;
			if (pojo.lines === 0xfff) pojo.lines = null;
			if (pojo.level === 0xff) pojo.level = null;

			// v3: 10 bits, v2: 9 bits
			const piece_null_value = pojo.version === 3 ? 0x3ff : 0x1ff;

			PIECES.forEach(piece => {
				if (pojo[piece] === piece_null_value) {
					pojo[piece] = null;
				}
			});
		}
		else {
			if (pojo.score === 0x1fffff) pojo.score = null;
			if (pojo.lines === 0b111111111) pojo.lines = null;
			if (pojo.level === 0b111111) pojo.level = null;

			PIECES.forEach(piece => {
				if (pojo[piece] === 0xff) {
					pojo[piece] = null;
				}
			});
		}

		if (pojo.instant_das === 0b11111) pojo.instant_das = null;
		if (pojo.cur_piece_das === 0b11111) pojo.cur_piece_das = null;

		if (pojo.preview === 0b111) {
			pojo.preview = null;
		} else {
			pojo.preview = VALUE_TO_PIECE[pojo.preview];
		}

		if (pojo.cur_piece === 0b111) {
			pojo.cur_piece = null;
		} else {
			pojo.cur_piece = VALUE_TO_PIECE[pojo.cur_piece];
		}

		return pojo;
	}

	static getCTime(frame_arr) {
		return (
			(frame_arr[3] << 20) |
			(frame_arr[4] << 12) |
			(frame_arr[5] << 4) |
			((frame_arr[6] & 0xf0) >> 4)
		);
	}

	static getFrameFromBuffer(buffer_or_uintarray) {
		let f;

		if (buffer_or_uintarray instanceof Uint8Array) {
			f = buffer_or_uintarray;
		} else {
			f = new Uint8Array(buffer_or_uintarray);
		}

		const version = f[0] >> 5; // 3 bits with mask 0b11100000

		if (!FRAME_SIZE_BY_VERSION[version]) {
			throw new Error('Invalid Frame: Version not supported');
		}

		const normal_size = FRAME_SIZE_BY_VERSION[version];

		if (f.length === normal_size) {
			return f;
		}

		if (f.length > normal_size) {
			throw new Error('Invalid frame: too long');
		}

		// Minor transport optimization below
		// The tail of the frame (field) may
		// be omitted and will pad with zeros to compensate

		if (f.length < normal_size - POSSIBLE_RIGHT_PADDING) {
			throw new Error('Invalid frame: too short');
		}

		// frame is too short, but paddable
		// 1. init as all zeros
		const padded = new Uint8Array(normal_size);

		// 2. (inefficient) copy the values from f
		// Can't we do a fast low-level buffer copy? :'(
		f.forEach((v, i) => (padded[i] = v));

		return padded;
	}
}

BinaryFrame.GAME_TYPE = GAME_TYPE;
BinaryFrame.FRAME_SIZE_BY_VERSION = FRAME_SIZE_BY_VERSION;
