# Steganography Decoder & Encoder Chrome Extension

Chrome extension (Manifest V3) for encoding and decoding hidden messages in images using LSB (Least Significant Bit) steganography:

Use this link to install in google chrome:
- https://chromewebstore.google.com/detail/steganography-decoder-enc/dmbgjpiekcpfkkfdekflejkbncajkkec

## Features

- **Encode**: Hide text messages in images using configurable LSB steganography
- **Decode**: Extract hidden messages from images
- **Configurable parameters**:
  - Bits per channel (1-8)
  - Channel selection (R, G, B)
  - Pixel traversal order (row/column)
  - Text encoding (UTF-8/ASCII)

## Project Structure

```
stego-extention/
├── manifest.json          # Chrome extension manifest
├── background.js          # Service worker for extension
├── decoder.html           # Main UI page
├── decoder.js             # UI logic for decoder
├── encoder.js             # UI logic for encoder
├── decoder.css            # Styles
├── lsb.js                 # Core LSB steganography library
├── lsb.test.js            # Tests for LSB library
├── test.html              # Test runner page
└── README.md              # This file
```

## Core Library

The `lsb.js` file contains the core steganography functions:

- `encodeLSB(imageData, message, config)` - Encodes a message into image data
- `decodeLSB(imageData, options)` - Decodes a message from image data

These functions are pure and can be used independently of the UI.

## Testing

Tests are written using **Mocha** and **Chai** testing frameworks.

### Running Tests

```bash
npm test
```

### Test Coverage

The test suite includes **19 tests** covering:

- ✅ Basic encode/decode with various bit counts (1-8)
- ✅ Different channel combinations (RGB, RG, R only, etc.)
- ✅ Row and column pixel orders
- ✅ UTF-8 and ASCII encodings
- ✅ UTF-8 with special characters and emojis
- ✅ Long messages
- ✅ Error handling (message too long, no channels, invalid parameters)
- ✅ Round-trip consistency

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `stego-extention` directory

## Usage

1. Click the extension icon to open the decoder/encoder page
2. **To decode**: Load an image, configure parameters, click "Decode"
3. **To encode**: Switch to "Encode" tab, load an image, enter message, configure parameters, click "Encode", then download the result

## Development

### Adding New Features

The codebase is structured with separation of concerns:

- **UI Logic**: `decoder.js`, `encoder.js` - handle user interactions
- **Core Logic**: `lsb.js` - pure functions for steganography
- **Tests**: `lsb.test.js` - comprehensive test suite

When adding features:
1. Add core functionality to `lsb.js`
2. Add tests to `lsb.test.js`
3. Update UI in `decoder.js` or `encoder.js` as needed

## How to download word lists

```python
!pip install wordfreq
>>> import json; from wordfreq import top_n_list; json.dump({k: top_n_list(k, 20000) for k in ["en","ru","de","fr","es","pt"]}, open("top_words.json","w",encoding="utf-8"), ensure_ascii=False)
```

## License

MIT

