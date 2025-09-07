import QueryString from '/js/QueryString.js';

import { CpuTetrisOCR } from './cpuTetrisOCR.js';
import { WGpuTetrisOCR } from './webgpu/wgpuTetrisOCR.js';
import { WGlTetrisOCR } from './webgl/wglTetrisOCR.js';

const force_ocr_mode = (value => {
	return /^(wgpu|wgl|cpu)$/.test(value) ? value : null;
})(QueryString.get('ocr'));

function hasWebGL2({ allowSoftware = true } = {}) {
	try {
		const canvas =
			typeof OffscreenCanvas !== 'undefined'
				? new OffscreenCanvas(1, 1)
				: document.createElement('canvas');

		const attrs = {
			alpha: true,
			premultipliedAlpha: true,
			powerPreference: 'high-performance',
			failIfMajorPerformanceCaveat: !allowSoftware,
		};
		return !!canvas.getContext('webgl2', attrs);
	} catch {
		return false;
	}
}

async function hasWebGPU() {
	try {
		const adapter = await navigator.gpu?.requestAdapter();
		return !!adapter;
	} catch {
		return false;
	}
}

async function doGetOcrClass() {
	// force_ocr_mode has precedence
	switch (force_ocr_mode) {
		case 'wgpu':
			return WGpuTetrisOCR;
		case 'wgl':
			return WGlTetrisOCR;
		case 'cpu':
			return CpuTetrisOCR;
	}

	// if no force_ocr_mode matched, use precendence rules below:
	if (await hasWebGPU()) {
		return WGpuTetrisOCR;
	}

	if (hasWebGL2()) {
		return WGlTetrisOCR;
	}

	return CpuTetrisOCR;
}

const getOcrClassPromise = doGetOcrClass(); // no await, shared promise

export async function getOcrClass() {
	return await getOcrClassPromise;
}

export async function createOCRInstance(config) {
	const klass = await getOcrClass();

	return new klass(config);
}
