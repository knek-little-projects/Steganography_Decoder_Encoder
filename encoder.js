import { encodeLSB as encodeLSBCore } from './lsb.js';
import { jpegEncode as jpegEncodeCore } from './stegojpeg.js';

let currentImageDataForEncode = null;
let originalImageDataForEncode = null; // Unresized original
let currentEncodeMethod = 'jpeg-dct'; // Track current method for download
let currentJpegQuality = 0.95; // Track JPEG quality for download
let currentEncodedBlob = null; // Stores the final-format blob for preview & download
let currentPreviewBlobUrl = null; // Object URL for preview img

const messageInput = document.getElementById('messageInput');
const charCount = document.getElementById('charCount');
const encodeButton = document.getElementById('encodeButton');
const encodeStatusLabel = document.getElementById('encodeStatusLabel');
const encodedCanvas = document.getElementById('encodedCanvas');
const encodedPreviewImg = document.getElementById('encodedPreviewImg');
const encodeDownloadButton = document.getElementById('encodeDownloadButton');
const capacityInfo = document.getElementById('capacityInfo');
const capacityText = document.getElementById('capacityText');
const encodedPreviewSection = document.getElementById('encodedPreviewSection');
const toggleEncoderOptionsBtn = document.getElementById('toggleEncoderOptions');
const encoderOptions = document.getElementById('encoderOptions');
const encodeMethodSelect = document.getElementById('encodeMethod');

// JPEG DCT controls
const jpegDctOptionsEl = document.getElementById('jpegDctOptions');
const dctRobustnessInput = document.getElementById('dctRobustness');
const dctRobustnessValue = document.getElementById('dctRobustnessValue');
const dctJpegQualityInput = document.getElementById('dctJpegQuality');
const dctJpegQualityValue = document.getElementById('dctJpegQualityValue');
const dctFillWithZerosInput = document.getElementById('dctFillWithZeros');
const dctMaxDimensionInput = document.getElementById('dctMaxDimension');
const dctMaxDimensionValue = document.getElementById('dctMaxDimensionValue');

// LSB wrapper
const lsbOptionsWrapper = document.getElementById('lsbOptionsWrapper');

// LSB controls
const encodeBitsPerChannelInput = document.getElementById('encodeBitsPerChannel');
const encodeChannelRInput = document.getElementById('encodeChannelR');
const encodeChannelGInput = document.getElementById('encodeChannelG');
const encodeChannelBInput = document.getElementById('encodeChannelB');
const encodeEncodingRadios = document.querySelectorAll('input[name="encodeEncoding"]');
const encodePixelOrderRadios = document.querySelectorAll('input[name="encodePixelOrder"]');
const fillWithZerosInput = document.getElementById('fillWithZeros');

function getSelectedEncodeEncoding() {
  const checked = Array.from(encodeEncodingRadios).find((r) => r.checked);
  return checked ? checked.value : 'utf8';
}

function getSelectedEncodePixelOrder() {
  const checked = Array.from(encodePixelOrderRadios).find((r) => r.checked);
  return checked ? checked.value : 'row';
}

function getSelectedEncodeMethod() {
  return encodeMethodSelect ? encodeMethodSelect.value : 'lossless-lsb';
}

function setEncodeStatus(message, isError = false) {
  encodeStatusLabel.textContent = message || '';
  encodeStatusLabel.classList.toggle('error', Boolean(isError));
}

function downloadEncodedImage() {
  if (!currentEncodedBlob) return;

  const ext = currentEncodeMethod === 'jpeg-dct' ? 'jpg' : 'png';
  const url = URL.createObjectURL(currentEncodedBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `encoded-image.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Convert canvas contents to a blob of the target format, then reload
 * that blob back onto the canvas so the preview matches the actual file.
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/** Load a Blob (JPEG/PNG) back into an ImageData via an off-screen canvas. */
function blobToImageData(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cx = c.getContext('2d');
        cx.drawImage(img, 0, 0);
        resolve(cx.getImageData(0, 0, c.width, c.height));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load JPEG blob back as image'));
    };
    img.src = url;
  });
}

/**
 * Encode a message with JPEG DCT steganography and return a ready Blob.
 *
 * Uses a double-pass technique so the stego data survives browser JPEG
 * re-compression:
 *   Pass 1 – embed message → JPEG-compress → decode back to pixels
 *            (pixels are now "JPEG-stable")
 *   Pass 2 – embed message again into those stable pixels → JPEG-compress
 *            (this time the compression barely changes the coefficients)
 */
async function jpegEncodeToBlob(imageData, message, { step, fillWithZeros, quality }) {
  // --- Pass 1: encode + compress to get JPEG-stable pixels ---
  const firstPass = jpegEncodeCore(imageData, message, { step, fillWithZeros });

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = firstPass.width;
  tmpCanvas.height = firstPass.height;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.putImageData(firstPass, 0, 0);

  const firstBlob = await canvasToBlob(tmpCanvas, 'image/jpeg', quality);
  const stablePixels = await blobToImageData(firstBlob);

  // --- Pass 2: re-encode message into JPEG-stable pixels ---
  const secondPass = jpegEncodeCore(stablePixels, message, { step, fillWithZeros });

  tmpCtx.putImageData(secondPass, 0, 0);
  return canvasToBlob(tmpCanvas, 'image/jpeg', quality);
}

/**
 * Show the encoded blob in the preview <img> element.
 * The blob is in the final target format (JPEG for DCT, PNG for LSB),
 * so "Save image as" gives the correct format.
 */
function showBlobInPreview(blob) {
  // Revoke previous URL to avoid memory leaks
  if (currentPreviewBlobUrl) {
    URL.revokeObjectURL(currentPreviewBlobUrl);
  }
  currentPreviewBlobUrl = URL.createObjectURL(blob);
  if (encodedPreviewImg) {
    encodedPreviewImg.src = currentPreviewBlobUrl;
  }
}

/**
 * Proportionally resize ImageData so that the largest dimension
 * does not exceed maxDim. Returns the original if already within bounds.
 */
function resizeImageData(imageData, maxDim) {
  const { width, height } = imageData;
  if (width <= maxDim && height <= maxDim) return imageData;

  let newW, newH;
  if (width >= height) {
    newW = maxDim;
    newH = Math.round(height * (maxDim / width));
  } else {
    newH = maxDim;
    newW = Math.round(width * (maxDim / height));
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(imageData, 0, 0);

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = newW;
  dstCanvas.height = newH;
  const dstCtx = dstCanvas.getContext('2d');
  dstCtx.drawImage(srcCanvas, 0, 0, newW, newH);

  return dstCtx.getImageData(0, 0, newW, newH);
}

function applyResizeToCurrentImage() {
  if (!originalImageDataForEncode) return;
  const maxDim = dctMaxDimensionInput ? parseInt(dctMaxDimensionInput.value, 10) : 1280;
  currentImageDataForEncode = resizeImageData(originalImageDataForEncode, maxDim);
  updateCapacity();
}

export function setImageForEncode(imageData) {
  originalImageDataForEncode = imageData;
  applyResizeToCurrentImage();
  if (encodeDownloadButton) {
    encodeDownloadButton.style.display = 'none';
  }
}

function updateCapacity() {
  if (!currentImageDataForEncode) {
    capacityInfo.style.display = 'none';
    return;
  }

  const method = getSelectedEncodeMethod();

  if (method === 'jpeg-dct') {
    const blocksX = Math.floor(currentImageDataForEncode.width / 8);
    const blocksY = Math.floor(currentImageDataForEncode.height / 8);
    const totalBlocks = blocksX * blocksY;
    const payloadBits = Math.max(0, totalBlocks - 32); // 32 bits for header
    const totalBytes = Math.floor(payloadBits / 8);

    capacityText.textContent = `~${totalBytes.toLocaleString()} bytes (${totalBlocks.toLocaleString()} blocks of 8×8, JPEG DCT)`;
    capacityInfo.style.display = 'block';
    return;
  }

  // Lossless LSB capacity
  const bitsPerChannel = parseInt(encodeBitsPerChannelInput.value, 10) || 1;
  const channels = [
    encodeChannelRInput.checked,
    encodeChannelGInput.checked,
    encodeChannelBInput.checked,
  ].filter(Boolean).length;

  if (channels === 0) {
    capacityInfo.style.display = 'none';
    return;
  }

  const totalBits = currentImageDataForEncode.width * currentImageDataForEncode.height * channels * bitsPerChannel;
  const totalBytes = Math.floor(totalBits / 8);
  
  const encoding = getSelectedEncodeEncoding();
  const avgBytesPerChar = encoding === 'utf8' ? 2 : 1;
  const estimatedChars = Math.floor(totalBytes / avgBytesPerChar);

  capacityText.textContent = `~${estimatedChars.toLocaleString()} characters (${totalBytes.toLocaleString()} bytes, ${totalBits.toLocaleString()} bits)`;
  capacityInfo.style.display = 'block';
}

/**
 * Show/hide method-specific options based on encoding method selection.
 * Both option sets live inside the shared collapsible #encoderOptions panel.
 */
function updateMethodUI() {
  const method = getSelectedEncodeMethod();
  const isLSB = method === 'lossless-lsb';

  // Toggle JPEG DCT options inside the shared panel
  if (jpegDctOptionsEl) {
    jpegDctOptionsEl.style.display = isLSB ? 'none' : '';
  }

  // Toggle LSB options inside the shared panel
  if (lsbOptionsWrapper) {
    lsbOptionsWrapper.style.display = isLSB ? '' : 'none';
  }

  updateCapacity();
}

/* ---- Slider live-value updates ---- */

if (dctMaxDimensionInput && dctMaxDimensionValue) {
  dctMaxDimensionInput.addEventListener('input', () => {
    dctMaxDimensionValue.textContent = dctMaxDimensionInput.value;
    applyResizeToCurrentImage();
  });
}

if (dctRobustnessInput && dctRobustnessValue) {
  dctRobustnessInput.addEventListener('input', () => {
    dctRobustnessValue.textContent = dctRobustnessInput.value;
  });
}

if (dctJpegQualityInput && dctJpegQualityValue) {
  dctJpegQualityInput.addEventListener('input', () => {
    dctJpegQualityValue.textContent = dctJpegQualityInput.value;
  });
}

if (messageInput) {
  messageInput.addEventListener('input', () => {
    const count = messageInput.value.length;
    if (charCount) charCount.textContent = count.toLocaleString();
    updateCapacity();
  });
}

if (encodeMethodSelect) {
  encodeMethodSelect.addEventListener('change', updateMethodUI);
}

if (encodeButton) {
  encodeButton.addEventListener('click', async () => {
  if (!currentImageDataForEncode) {
    setEncodeStatus('Please load an image first', true);
    return;
  }

  const message = messageInput.value.trim();
  if (!message) {
    setEncodeStatus('Please enter a message to encode', true);
    return;
  }

  const method = getSelectedEncodeMethod();
  currentEncodeMethod = method;

  try {
    setEncodeStatus('Encoding...');
    encodeButton.disabled = true;

    if (method === 'jpeg-dct') {
      const step = dctRobustnessInput ? parseInt(dctRobustnessInput.value, 10) : 50;
      const fillZeros = dctFillWithZerosInput ? dctFillWithZerosInput.checked : false;
      currentJpegQuality = dctJpegQualityInput
        ? parseInt(dctJpegQualityInput.value, 10) / 100
        : 0.95;

      // Double-pass encode → ready JPEG blob
      currentEncodedBlob = await jpegEncodeToBlob(
        currentImageDataForEncode, message,
        { step, fillWithZeros: fillZeros, quality: currentJpegQuality },
      );
    } else {
      const config = {
        bitsPerChannel: parseInt(encodeBitsPerChannelInput.value, 10) || 1,
        useR: encodeChannelRInput.checked,
        useG: encodeChannelGInput.checked,
        useB: encodeChannelBInput.checked,
        pixelOrder: getSelectedEncodePixelOrder(),
        encoding: getSelectedEncodeEncoding(),
        fillWithZeros: fillWithZerosInput ? fillWithZerosInput.checked : false,
      };

      if (!config.useR && !config.useG && !config.useB) {
        throw new Error('At least one channel must be selected');
      }

      const encodedImageData = encodeLSBCore(currentImageDataForEncode, message, config);

      encodedCanvas.width = encodedImageData.width;
      encodedCanvas.height = encodedImageData.height;
      const ctx = encodedCanvas.getContext('2d');
      ctx.putImageData(encodedImageData, 0, 0);

      currentEncodedBlob = await canvasToBlob(encodedCanvas, 'image/png');
    }

    if (currentEncodedBlob) {
      showBlobInPreview(currentEncodedBlob);
    }

    if (encodedPreviewSection) {
      encodedPreviewSection.style.display = 'flex';
    }
    if (encodeDownloadButton) {
      encodeDownloadButton.style.display = 'inline-flex';
    }

    const fmt = method === 'jpeg-dct' ? 'JPEG DCT' : 'Lossless LSB';
    setEncodeStatus(`Encoded successfully! (${fmt})`);
    downloadEncodedImage();
  } catch (error) {
    setEncodeStatus(error.message, true);
  } finally {
    if (encodeButton) encodeButton.disabled = false;
  }
  });
}

if (encodeDownloadButton) {
  encodeDownloadButton.addEventListener('click', () => {
    downloadEncodedImage();
  });
}

[encodeBitsPerChannelInput, encodeChannelRInput, encodeChannelGInput, encodeChannelBInput].forEach(el => {
  if (el) el.addEventListener('change', updateCapacity);
});

encodeEncodingRadios.forEach(radio => {
  if (radio) radio.addEventListener('change', updateCapacity);
});

// Toggle encoder options visibility
if (toggleEncoderOptionsBtn && encoderOptions) {
  toggleEncoderOptionsBtn.addEventListener('click', () => {
    const isVisible = encoderOptions.style.display !== 'none';
    encoderOptions.style.display = isVisible ? 'none' : 'block';
    toggleEncoderOptionsBtn.innerHTML = `<span class="toggle-icon">${isVisible ? '▼' : '▲'}</span> ${isVisible ? 'Show' : 'Hide'} encoder options`;
  });
}

// Init method UI on load
updateMethodUI();
