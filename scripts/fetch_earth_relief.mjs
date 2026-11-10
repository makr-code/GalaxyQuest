import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/etopo1_ice.json?z%5B(-90):30:(90)%5D%5B(-180):30:(180)%5D';
const response = await fetch(source, { signal: AbortSignal.timeout(180000) });
if (!response.ok) throw new Error(`ETOPO download failed: HTTP ${response.status}`);
const { table } = await response.json();
const width = 721, height = 361;
if (JSON.stringify(table?.columnNames) !== '["latitude","longitude","z"]'
  || JSON.stringify(table?.columnUnits) !== '["degrees_north","degrees_east","meters"]'
  || table.rows.length !== width * height) throw new Error('Unexpected ETOPO grid schema');
const bytes = Buffer.alloc(width * height * 2);
for (let index = 0; index < table.rows.length; index++) {
  const [lat, lon, z] = table.rows[index];
  if (lat !== -90 + Math.floor(index / width) * 0.5 || lon !== -180 + index % width * 0.5
    || !Number.isInteger(z) || z < -12000 || z > 9000) throw new Error(`Invalid ETOPO sample ${index}`);
  bytes.writeInt16LE(z, index * 2);
}
const output = new URL('../tools/data/earth/etopo1-ice-30arcmin.i16', import.meta.url);
await writeFile(output, bytes);
console.log(`ETOPO1 ice surface: ${width} x ${height}, ${bytes.length} bytes`);
console.log(`SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`);
