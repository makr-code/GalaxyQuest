#!/usr/bin/env python3
"""Create a minimal test PNG image for testing"""
import struct
import zlib
import base64

# Minimal 1x1 red pixel PNG
png_header = b'\x89PNG\r\n\x1a\n'

# IHDR chunk (image header)
ihdr_data = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)  # 1x1, 8-bit, RGB
ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
ihdr_chunk = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)

# IDAT chunk (image data)
idat_data = zlib.compress(b'\x00\xff\x00\x00')  # Simple red pixel
idat_crc = zlib.crc32(b'IDAT' + idat_data) & 0xffffffff
idat_chunk = struct.pack('>I', len(idat_data)) + b'IDAT' + idat_data + struct.pack('>I', idat_crc)

# IEND chunk (image end)
iend_crc = zlib.crc32(b'IEND') & 0xffffffff
iend_chunk = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)

png_data = png_header + ihdr_chunk + idat_chunk + iend_chunk

# Write to file
with open('/tmp/test_ship.png', 'wb') as f:
    f.write(png_data)

# Also output as base64 for easy paste
b64 = base64.b64encode(png_data).decode('ascii')
with open('/tmp/test_ship_base64.txt', 'w') as f:
    f.write(b64)

print(f"Test PNG created: {len(png_data)} bytes")
print(f"Base64 length: {len(b64)}")
