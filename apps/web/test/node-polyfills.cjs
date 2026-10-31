const zlib = require("node:zlib");

if (!zlib.createZstdDecompress) {
  zlib.createZstdDecompress = zlib.createBrotliDecompress;
}
