import { setImageForEncode } from './encoder.js';

import { decodeLSB, formatBytesAsAscii, formatBytesAsUtf8, formatBytesAsHex } from './lsb.js';
import { jpegDecode } from './stegojpeg.js';
import { autoDetectParametersByMaxLength } from './autoDetect.js';

const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const imagePreview = document.getElementById('imagePreview');
const metadataList = document.getElementById('metadataList');
const panelLeft = document.querySelector('.panel-left');

const bitsPerChannelInput = document.getElementById('bitsPerChannel');
const channelRInput = document.getElementById('channelR');
const channelGInput = document.getElementById('channelG');
const channelBInput = document.getElementById('channelB');
const decodeButton = document.getElementById('decodeButton');
const autoDetectButton = document.getElementById('autoDetectButton');
const manualDecodeToggle = document.getElementById('manualDecodeToggle');
const manualDecodeOptions = document.getElementById('manualDecodeOptions');
const statusLabel = document.getElementById('statusLabel');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

const textOutput = document.getElementById('textOutput');
const hexOutput = document.getElementById('hexOutput');
const copyTextButton = document.getElementById('copyTextButton');
const copyHexButton = document.getElementById('copyHexButton');
const candidatesSection = document.getElementById('candidatesSection');
const candidatesList = document.getElementById('candidatesList');
const decodedTextSection = document.getElementById('decodedTextSection');
const hexViewSection = document.getElementById('hexViewSection');
const currentParamsInfo = document.getElementById('currentParamsInfo');
const currentParamsText = document.getElementById('currentParamsText');

// Display limits
const DISPLAY_BYTE_LIMIT = 1000; // Maximum bytes/characters to display initially

let fullDecodedText = ''; // Store full decoded text
let fullDecodedHex = ''; // Store full decoded hex
let autoDetectAbortController = null; // AbortController for stopping auto-detect

const encodingRadios = document.querySelectorAll('input[name="encoding"]');
const pixelOrderRadios = document.querySelectorAll('input[name="pixelOrder"]');

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let currentFile = null;
let currentImageData = null;


function updateImageUI(hasImage) {
  if (!panelLeft) return;
  panelLeft.classList.toggle('no-image', !hasImage);
  panelLeft.classList.toggle('has-image', hasImage);
}

function getSelectedEncoding() {
  const checked = Array.from(encodingRadios).find((r) => r.checked);
  return checked ? checked.value : 'utf8';
}

function getSelectedPixelOrder() {
  const checked = Array.from(pixelOrderRadios).find((r) => r.checked);
  return checked ? checked.value : 'row';
}

function setStatus(message, isError = false) {
  statusLabel.textContent = message || '';
  statusLabel.classList.toggle('error', Boolean(isError));
}

function updateMetadata(file, imageData) {
  metadataList.innerHTML = '';
  if (!file || !imageData) {
    return;
  }

  const entries = [
    ['File name', file.name],
    ['MIME type', file.type || 'unknown'],
    ['Size', `${(file.size / 1024).toFixed(1)} KB (${file.size} bytes)`],
    ['Dimensions', `${imageData.width} × ${imageData.height}`],
    [
      'Pixels',
      `${(imageData.width * imageData.height).toLocaleString('en-US')}`,
    ],
  ];

  for (const [label, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    metadataList.appendChild(dt);
    metadataList.appendChild(dd);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function clearOutputs() {
  textOutput.textContent = '';
  hexOutput.textContent = '';
  fullDecodedText = '';
  fullDecodedHex = '';
  candidatesSection.style.display = 'none';
  candidatesList.innerHTML = '';
  decodedTextSection.style.display = 'none';
  hexViewSection.style.display = 'none';
}

function ensureAtLeastOneChannel() {
  const anyChecked = channelRInput.checked || channelGInput.checked || channelBInput.checked;
  decodeButton.disabled = !anyChecked;
}

function onBitsPerChannelBlur() {
  let value = parseInt(bitsPerChannelInput.value, 10);
  if (Number.isNaN(value)) {
    value = 1;
  }
  value = Math.min(8, Math.max(1, value));
  bitsPerChannelInput.value = String(value);
}

// decodeImageData is now imported from lsb.js as decodeLSB

function readSettingsFromForm() {
  const bits = parseInt(bitsPerChannelInput.value, 10);
  const bitsPerChannel = Number.isNaN(bits)
    ? 1
    : Math.min(8, Math.max(1, bits));

  return {
    bitsPerChannel,
    useR: channelRInput.checked,
    useG: channelGInput.checked,
    useB: channelBInput.checked,
    order: getSelectedPixelOrder(),
    encoding: getSelectedEncoding(),
  };
}

function applySettingsToForm(settings) {
  if (!settings) return;
  if (typeof settings.bitsPerChannel === 'number') {
    bitsPerChannelInput.value = String(
      Math.min(8, Math.max(1, settings.bitsPerChannel)),
    );
  }
  if (typeof settings.useR === 'boolean') channelRInput.checked = settings.useR;
  if (typeof settings.useG === 'boolean') channelGInput.checked = settings.useG;
  if (typeof settings.useB === 'boolean') channelBInput.checked = settings.useB;

  if (typeof settings.order === 'string') {
    for (const radio of pixelOrderRadios) {
      radio.checked = radio.value === settings.order;
    }
  }
  if (typeof settings.encoding === 'string') {
    for (const radio of encodingRadios) {
      radio.checked = radio.value === settings.encoding;
    }
  }
  ensureAtLeastOneChannel();
}


function handleDecodeClick() {
  setStatus('');
  clearOutputs();

  if (!currentImageData) {
    setStatus('Load an image first.', true);
    return;
  }

  const { bitsPerChannel, useR, useG, useB, order, encoding } =
    readSettingsFromForm();

  if (!useR && !useG && !useB) {
    setStatus('Select at least one channel (R, G or B).', true);
    return;
  }

  try {
    const t0 = performance.now();
    const result = decodeLSB(currentImageData, {
      bitsPerChannel,
      useR,
      useG,
      useB,
      order,
    });
    const t1 = performance.now();

    // Format bytes for display based on encoding
    const formattedText = encoding === 'ascii'
      ? formatBytesAsAscii(result.bytes, result.hasTail, result.tailBits || 0)
      : formatBytesAsUtf8(result.bytes, result.hasTail, result.tailBits || 0);
    const formattedHex = formatBytesAsHex(result.bytes);

    // Store full text and hex
    fullDecodedText = formattedText;
    fullDecodedHex = formattedHex;
    
    // Display only first DISPLAY_BYTE_LIMIT characters with "show more" link
    if (formattedText.length > DISPLAY_BYTE_LIMIT) {
      const truncated = formattedText.substring(0, DISPLAY_BYTE_LIMIT);
      textOutput.innerHTML = escapeHtml(truncated) + ' <a href="#" class="show-more-link">[show more...]</a>';
    } else {
      textOutput.textContent = formattedText;
    }
    
    // Display only first DISPLAY_BYTE_LIMIT bytes in hex with "show more" link
    if (result.bytes.length > DISPLAY_BYTE_LIMIT) {
      const truncatedBytes = result.bytes.slice(0, DISPLAY_BYTE_LIMIT);
      const truncatedHex = formatBytesAsHex(truncatedBytes);
      hexOutput.innerHTML = escapeHtml(truncatedHex) + ' <a href="#" class="show-more-link">[show more...]</a>';
    } else {
      hexOutput.textContent = formattedHex;
    }

    // Show results sections
    decodedTextSection.style.display = 'flex';
    hexViewSection.style.display = 'flex';

    const bitsUsed =
      currentImageData.width *
      currentImageData.height *
      (Number(useR) + Number(useG) + Number(useB)) *
      bitsPerChannel;
    const summary = [
      `${result.byteCount} bytes`,
      `${bitsPerChannel} bit(s)/channel`,
      `order: ${order}`,
      `encoding: ${encoding.toUpperCase()}`,
      `~${(t1 - t0).toFixed(1)} ms`,
    ];
    setStatus(summary.join(' · '), false);
  } catch (e) {
    console.error('Decode error', e);
    setStatus('Decode failed. See console for details.', true);
  }
}

function applyCandidate(candidate) {
  if (!currentImageData) {
    setStatus('Image data not available.', true);
    return;
  }

  // Stop auto-detect if it's still running
  if (autoDetectAbortController) {
    console.log('Stopping auto-detect from applyCandidate');
    try {
      if (!autoDetectAbortController.signal.aborted) {
        autoDetectAbortController.abort();
      }
    } catch (e) {
      console.warn('Error aborting auto-detect:', e);
    }
    autoDetectAbortController = null;
    if (progressContainer) progressContainer.style.display = 'none';
    // Restore button to AUTO DECODE
    if (autoDetectButton) {
      autoDetectButton.textContent = 'AUTO DECODE';
      autoDetectButton.className = 'button-primary decode-mode-btn';
      autoDetectButton.disabled = false;
    }
    if (decodeButton) decodeButton.disabled = false;
  }

  const { bitsPerChannel, useR, useG, useB, order, encoding } = candidate.params;

  if (candidate._isJpegDct) {
    // JPEG DCT candidate — hide LSB manual options (they are irrelevant)
    if (manualDecodeOptions) {
      manualDecodeOptions.style.display = 'none';
    }
    if (manualDecodeToggle) {
      const arrow = manualDecodeToggle.querySelector('.toggle-arrow');
      if (arrow) arrow.textContent = '▶';
    }
  } else {
    // Apply LSB candidate parameters to form
    bitsPerChannelInput.value = String(bitsPerChannel);
    channelRInput.checked = useR;
    channelGInput.checked = useG;
    channelBInput.checked = useB;

    // Set pixel order
    for (const radio of pixelOrderRadios) {
      radio.checked = radio.value === order;
    }

    // Set encoding
    for (const radio of encodingRadios) {
      radio.checked = radio.value === encoding;
    }

    ensureAtLeastOneChannel();

    // Expand manual decode options and show selected parameters
    if (manualDecodeOptions && manualDecodeToggle) {
      manualDecodeOptions.style.display = 'block';
      const arrow = manualDecodeToggle.querySelector('.toggle-arrow');
      if (arrow) {
        arrow.textContent = '▼';
      }
    }
  }

  // Decode again with full data (not just preview)
  try {
    setStatus('Decoding with selected parameters...', false);

    let formattedText, formattedHex, byteCount;

    if (candidate._isJpegDct) {
      // JPEG DCT candidate — re-decode with jpegDecode
      const dctResult = jpegDecode(currentImageData);
      formattedText = dctResult.message;
      const msgBytes = new TextEncoder().encode(dctResult.message);
      formattedHex = formatBytesAsHex(msgBytes);
      byteCount = msgBytes.length;
    } else {
      const result = decodeLSB(currentImageData, {
        bitsPerChannel,
        useR,
        useG,
        useB,
        order,
      });

      // Format bytes for display based on encoding
      formattedText = encoding === 'ascii'
        ? formatBytesAsAscii(result.bytes, result.hasTail, result.tailBits || 0)
        : formatBytesAsUtf8(result.bytes, result.hasTail, result.tailBits || 0);
      formattedHex = formatBytesAsHex(result.bytes);
      byteCount = result.byteCount;
    }

    // Store full text and hex
    fullDecodedText = formattedText;
    fullDecodedHex = formattedHex;
    
    // Display only first DISPLAY_BYTE_LIMIT characters with "show more" link
    if (formattedText.length > DISPLAY_BYTE_LIMIT) {
      const truncated = formattedText.substring(0, DISPLAY_BYTE_LIMIT);
      textOutput.innerHTML = escapeHtml(truncated) + ' <a href="#" class="show-more-link">[show more...]</a>';
    } else {
      textOutput.textContent = formattedText;
    }
    
    // Display only first DISPLAY_BYTE_LIMIT bytes in hex with "show more" link
    const hexBytes = new TextEncoder().encode(formattedText);
    if (hexBytes.length > DISPLAY_BYTE_LIMIT) {
      const truncatedBytes = hexBytes.slice(0, DISPLAY_BYTE_LIMIT);
      const truncatedHex = formatBytesAsHex(truncatedBytes);
      hexOutput.innerHTML = escapeHtml(truncatedHex) + ' <a href="#" class="show-more-link">[show more...]</a>';
    } else {
      hexOutput.textContent = formattedHex;
    }

    // Hide candidates section and show results
    candidatesSection.style.display = 'none';
    decodedTextSection.style.display = 'flex';
    hexViewSection.style.display = 'flex';
    
    if (candidate._isJpegDct) {
      setStatus(`JPEG DCT · ${byteCount} bytes`, false);
    } else {
      const summary = [
        `${bitsPerChannel} bit(s)/channel`,
        `${useR ? 'R' : ''}${useG ? 'G' : ''}${useB ? 'B' : ''}`,
        `order: ${order}`,
        `encoding: ${encoding.toUpperCase()}`,
        `${byteCount} bytes`,
      ];
      setStatus(summary.join(' · '), false);
    }
  } catch (e) {
    console.error('Decode error', e);
    setStatus('Failed to decode with selected parameters. See console for details.', true);
  }
}

function displayCandidates(candidates) {
  if (!candidates || candidates.length === 0) {
    if (candidatesList.innerHTML.includes('Detecting')) {
      // Still detecting, don't clear
      return;
    }
    candidatesList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No candidates found yet...</div>';
    return;
  }

  // Clear and rebuild list
  candidatesList.innerHTML = '';
  
  candidates.forEach((candidate, index) => {
    // Use only preview bytes (first 100 bytes) for display
    const previewBytes = candidate.result.bytes;
    const formattedText = candidate.params.encoding === 'ascii'
      ? formatBytesAsAscii(previewBytes, false, 0) // Preview doesn't have tail info
      : formatBytesAsUtf8(previewBytes, false, 0);
    
    const textScore = candidate.textScoreResult?.score ?? 0;
    const textQuality = calculateTextQualityScore(formattedText, candidate.textScoreResult);
    const dictionaryScore = candidate.dictionaryScore || 0;
    const detectedLanguage = candidate.detectedLanguage || null;
    
    const item = document.createElement('div');
    item.className = 'candidate-item';
    // Add medal class for top-3 candidates
    if (index === 0) item.classList.add('candidate-gold');
    else if (index === 1) item.classList.add('candidate-silver');
    else if (index === 2) item.classList.add('candidate-bronze');
    
    // Preview is already limited to 100 bytes, just clean it up for display
    const preview = formattedText.replace(/\n/g, ' ').substring(0, 100);
    const previewText = preview + (previewBytes.length >= 100 ? '...' : '');
    
    const isJpegDct = candidate._isJpegDct;
    const channels = isJpegDct ? '' : `${candidate.params.useR ? 'R' : ''}${candidate.params.useG ? 'G' : ''}${candidate.params.useB ? 'B' : ''}`;
    const paramsLabel = isJpegDct
      ? 'JPEG DCT'
      : `${candidate.params.bitsPerChannel}bit/${channels} ${candidate.params.order} ${candidate.params.encoding.toUpperCase()}`;
    
    // Medal emoji for top-3
    const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
    const bestBadge = index === 0 ? '<span class="best-match-badge">Best match</span>' : '';
    
    item.innerHTML = `
      <div class="candidate-header">
        <span class="candidate-rank">${medal} #${index + 1}</span>
        ${bestBadge}
        <span class="candidate-params">${paramsLabel}</span>
        <div class="candidate-scores">
          ${textScore > 0 ? `<span class="score-badge score-text">Text: ${(textScore * 100).toFixed(0)}%</span>` : ''}
          ${dictionaryScore > 0 ? `<span class="score-badge score-dict">${detectedLanguage || 'dict'}: ${(dictionaryScore * 100).toFixed(0)}%</span>` : ''}
          <span class="score-badge score-quality">Quality: ${textQuality.toFixed(0)}</span>
        </div>
      </div>
      <div class="candidate-preview">${escapeHtml(previewText)}</div>
    `;
    
    // Click the whole card to apply
    item.addEventListener('click', () => {
      applyCandidate(candidate);
    });
    
    candidatesList.appendChild(item);
  });
  
  const countEl = candidatesSection.querySelector('.candidates-count');
  if (countEl) {
    countEl.textContent = `${candidates.length} candidate${candidates.length !== 1 ? 's' : ''}`;
  }
  
  candidatesSection.style.display = 'block';
}

function calculateTextQualityScore(text, textScoreResult) {
  if (!text || text.length === 0 || !textScoreResult) {
    return 0;
  }
  
  let score = (textScoreResult.score || 0) * 70;
  
  if (textScoreResult.metrics?.components) {
    const comp = textScoreResult.metrics.components;
    score += comp.ctrlScore * 10;
    score += comp.compScore * 5;
    score += comp.entScore * 5;
  }
  
  const sample = text.substring(0, Math.min(200, text.length));
  const letterCount = (sample.match(/[a-zA-Zа-яА-Я]/g) || []).length;
  const letterRatio = letterCount / sample.length;
  
  if (letterRatio >= 0.3 && letterRatio <= 0.8) {
    score += 10;
  } else if (letterRatio < 0.1) {
    score -= 10;
  }
  
  if (sample.includes(' ') || sample.includes('\n') || sample.includes('\t')) {
    score += 5;
  }
  
  const specialCharCount = (sample.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/g) || []).length;
  const specialCharRatio = specialCharCount / sample.length;
  if (specialCharRatio > 0.3) {
    score -= 10;
  }
  
  return Math.max(0, Math.min(100, score));
}

async function handleAutoDetectClick() {
  // If auto-detect is already running (button shows STOP), stop it
  if (autoDetectButton.textContent === 'STOP' && autoDetectAbortController) {
    console.log('Stopping auto-detect from button click');
    if (!autoDetectAbortController.signal.aborted) {
      autoDetectAbortController.abort();
    }
    autoDetectAbortController = null;
    progressContainer.style.display = 'none';
    // Restore button to AUTO DECODE
    autoDetectButton.textContent = 'AUTO DECODE';
    autoDetectButton.className = 'button-primary decode-mode-btn';
    autoDetectButton.disabled = false;
    decodeButton.disabled = false;
    
    // Hide current params info
    if (currentParamsInfo) currentParamsInfo.style.display = 'none';
    
    // Show manual decode button again
    if (manualDecodeToggle) manualDecodeToggle.style.display = 'inline-flex';
    
    // Don't clear candidates - keep them visible
    setStatus('Auto-detect stopped by user.', false);
    return;
  }

  setStatus('');
  // Clear only text/hex outputs, not candidates
  textOutput.textContent = '';
  hexOutput.textContent = '';
  fullDecodedText = '';
  fullDecodedHex = '';
  decodedTextSection.style.display = 'none';
  hexViewSection.style.display = 'none';

  if (!currentImageData) {
    setStatus('Load an image first.', true);
    return;
  }

  // Change button to STOP (red)
  autoDetectButton.textContent = 'STOP';
  autoDetectButton.className = 'button-stop decode-mode-btn';
  autoDetectButton.disabled = false; // Keep enabled so user can click STOP

  // Hide manual decode button and options
  if (manualDecodeToggle) manualDecodeToggle.style.display = 'none';
  if (manualDecodeOptions) manualDecodeOptions.style.display = 'none';

  setStatus('Detecting parameters...');
  decodeButton.disabled = true;
  progressContainer.style.display = 'flex';
  progressBar.style.width = '0%';
  progressText.textContent = '0%';

  // Show candidates section immediately
  candidatesSection.style.display = 'block';
  // Only clear if empty, otherwise keep existing candidates
  if (candidatesList.innerHTML === '' || candidatesList.innerHTML.includes('Detecting')) {
    candidatesList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Detecting candidates...</div>';
  }

  // Show current params info
  if (currentParamsInfo) currentParamsInfo.style.display = 'block';
  if (currentParamsText) currentParamsText.textContent = 'Starting detection...';

  // Create AbortController for cancellation
  autoDetectAbortController = new AbortController();

  // Pre-compute JPEG DCT candidate (fast) to prepend to real-time updates
  let jpegDctCandidate = null;
  try {
    const dctResult = jpegDecode(currentImageData);
    if (dctResult.valid && dctResult.message.length > 0) {
      jpegDctCandidate = {
        params: {
          bitsPerChannel: '-',
          useR: false, useG: false, useB: false,
          order: 'dct',
          encoding: 'utf8',
        },
        result: {
          text: dctResult.message,
          bytes: new TextEncoder().encode(dctResult.message),
        },
        textScoreResult: { score: 1 },
        dictionaryScore: 0,
        detectedLanguage: null,
        _isJpegDct: true,
      };
      displayCandidates([jpegDctCandidate]);
    }
  } catch (_) { /* JPEG DCT not present — that's fine */ }

  try {
    const t0 = performance.now();
    const detection = await autoDetectParametersByMaxLength(currentImageData, {
      bitsPerChannel: [1, 2, 3, 4],
      quickMode: false,
      onProgress: (current, total, percentage) => {
        if (autoDetectAbortController && autoDetectAbortController.signal.aborted) {
          return;
        }
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
      },
      onCurrentParams: (params) => {
        if (autoDetectAbortController && autoDetectAbortController.signal.aborted) {
          return;
        }
        if (currentParamsText) {
          currentParamsText.textContent = `Testing: ${params.bitsPerChannel}bit/${params.channels} ${params.order} ${params.encoding.toUpperCase()} (${params.current}/${params.total})`;
        }
      },
      onCandidate: (sortedCandidates) => {
        // Update candidates list in real-time, prepend JPEG DCT if valid
        if (autoDetectAbortController && autoDetectAbortController.signal.aborted) {
          return;
        }
        const merged = jpegDctCandidate
          ? [jpegDctCandidate, ...sortedCandidates]
          : sortedCandidates;
        displayCandidates(merged);
      },
      abortSignal: autoDetectAbortController.signal,
    });
    const t1 = performance.now();

    // Hide progress bar and restore button
    progressContainer.style.display = 'none';
    autoDetectAbortController = null; // Clear abort controller after completion
    autoDetectButton.textContent = 'AUTO DECODE';
    autoDetectButton.className = 'button-primary decode-mode-btn';
    
    // Hide current params info
    if (currentParamsInfo) currentParamsInfo.style.display = 'none';
    
    // Show manual decode button again
    if (manualDecodeToggle) manualDecodeToggle.style.display = 'inline-flex';

    if (!detection.candidates || detection.candidates.length === 0) {
      setStatus('Could not detect parameters. Try manual decoding.', true);
      if (candidatesList.innerHTML.includes('Detecting')) {
        candidatesSection.style.display = 'none';
      }
      return;
    }

    // Merge JPEG DCT candidate (if found earlier) with LSB candidates
    const finalCandidates = jpegDctCandidate
      ? [jpegDctCandidate, ...(detection.candidates || [])]
      : (detection.candidates || []);

    displayCandidates(finalCandidates);
    
    setStatus(`Found ${detection.candidates.length} candidate(s) in ~${(t1 - t0).toFixed(0)}ms. Select one to view details.`, false);
  } catch (e) {
    if (e.name === 'AbortError') {
      setStatus('Auto-detect stopped by user.', false);
      // Don't clear candidates - keep them visible
    } else {
      console.error('Auto-detect error', e);
      setStatus('Auto-detect failed. See console for details.', true);
    }
    progressContainer.style.display = 'none';
    // Restore button to AUTO DECODE
    autoDetectButton.textContent = 'AUTO DECODE';
    autoDetectButton.className = 'button-primary decode-mode-btn';
    autoDetectAbortController = null;
    
    // Hide current params info
    if (currentParamsInfo) currentParamsInfo.style.display = 'none';
    
    // Show manual decode button again
    if (manualDecodeToggle) manualDecodeToggle.style.display = 'inline-flex';
    // Don't hide candidates section - keep found candidates visible
  } finally {
    autoDetectButton.disabled = false;
    decodeButton.disabled = false;
  }
}


function handleFile(file) {
  if (!file) return;
  currentFile = file;
  clearOutputs();
  setStatus('Loading image...');

  const reader = new FileReader();
  reader.onload = (event) => {
    const url = event.target && event.target.result;
    if (!url) {
      setStatus('Unable to read file.', true);
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        imagePreview.src = url;
        imagePreview.style.display = 'block';
        updateMetadata(file, currentImageData);
        updateImageUI(true);
        // Notify encoder about new image
        if (typeof setImageForEncode === 'function') {
          setImageForEncode(currentImageData);
        }
        setStatus('Image loaded. Ready to decode.');
        
        // Auto-start autodecode if we're on the Decode tab
        const decodePanel = document.getElementById('decodePanel');
        if (decodePanel && decodePanel.style.display !== 'none') {
          // Use setTimeout to ensure image is fully loaded before starting autodecode
          setTimeout(() => {
            handleAutoDetectClick();
          }, 100);
        }
      } catch (e) {
        console.error('Canvas decode error', e);
        currentImageData = null;
        imagePreview.removeAttribute('src');
        updateMetadata(null, null);
        updateImageUI(false);
        setStatus('Failed to read pixels from image.', true);
      }
    };
    img.onerror = () => {
      currentImageData = null;
      imagePreview.removeAttribute('src');
      updateMetadata(null, null);
      updateImageUI(false);
      setStatus('Failed to load image.', true);
    };
    img.src = url;
  };
  reader.onerror = () => {
    setStatus('File read error.', true);
  };
  reader.readAsDataURL(file);
}

function handleFileInputChange(event) {
  const input = event.target;
  if (!input.files || input.files.length === 0) {
    return;
  }
  const file = input.files[0];
  handleFile(file);
}

function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove('drag-over');
  const dt = event.dataTransfer;
  if (!dt || !dt.files || dt.files.length === 0) {
    return;
  }
  const file = dt.files[0];
  handleFile(file);
}

function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.add('drag-over');
}

function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  dropZone.classList.remove('drag-over');
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus('Copied to clipboard.');
      return;
    }
  } catch {
    // fall through to fallback
  }
  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    setStatus('Copied to clipboard.');
  } catch (e) {
    console.error('Clipboard error', e);
    setStatus('Failed to copy to clipboard.', true);
  } finally {
    document.body.removeChild(temp);
  }
}

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const appMain = document.querySelector('.app-main');
  const decodePanel = document.getElementById('decodePanel');
  const encodePanel = document.getElementById('encodePanel');
  const morePanel = document.getElementById('morePanel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (tab === 'decode') {
        decodePanel.style.display = 'flex';
        encodePanel.style.display = 'none';
        morePanel.style.display = 'none';
        if (appMain) appMain.classList.remove('more-only');
      } else if (tab === 'encode') {
        decodePanel.style.display = 'none';
        encodePanel.style.display = 'flex';
        morePanel.style.display = 'none';
        if (appMain) appMain.classList.remove('more-only');
      } else {
        decodePanel.style.display = 'none';
        encodePanel.style.display = 'none';
        morePanel.style.display = 'flex';
        if (appMain) appMain.classList.add('more-only');
      }
    });
  });
}

function init() {
  ensureAtLeastOneChannel();
  initTabs();
  updateImageUI(false);

  fileInput.addEventListener('change', handleFileInputChange);

  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);

  decodeButton.addEventListener('click', handleDecodeClick);
  autoDetectButton.addEventListener('click', handleAutoDetectClick);
  bitsPerChannelInput.addEventListener('blur', onBitsPerChannelBlur);
  
  // Toggle manual decode options
  if (manualDecodeToggle && manualDecodeOptions) {
    manualDecodeToggle.addEventListener('click', () => {
      const isVisible = manualDecodeOptions.style.display !== 'none';
      manualDecodeOptions.style.display = isVisible ? 'none' : 'block';
      const arrow = manualDecodeToggle.querySelector('.toggle-arrow');
      if (arrow) {
        arrow.textContent = isVisible ? '▶' : '▼';
      }
    });
  }

  channelRInput.addEventListener('change', () => {
    ensureAtLeastOneChannel();
  });
  channelGInput.addEventListener('change', () => {
    ensureAtLeastOneChannel();
  });
  channelBInput.addEventListener('change', () => {
    ensureAtLeastOneChannel();
  });

  copyTextButton.addEventListener('click', () =>
    copyToClipboard(fullDecodedText || textOutput.textContent),
  );
  copyHexButton.addEventListener('click', () =>
    copyToClipboard(fullDecodedHex || hexOutput.textContent || ''),
  );
  
  // Handle "show more" link clicks for text
  textOutput.addEventListener('click', (e) => {
    if (e.target.classList.contains('show-more-link')) {
      e.preventDefault();
      if (fullDecodedText) {
        textOutput.textContent = fullDecodedText;
      }
    }
  });
  
  // Handle "show more" link clicks for hex
  hexOutput.addEventListener('click', (e) => {
    if (e.target.classList.contains('show-more-link')) {
      e.preventDefault();
      if (fullDecodedHex) {
        hexOutput.textContent = fullDecodedHex;
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);


