import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const width = 1024;
const height = 1024;
const modelPath = path.join(root, 'models', 'ship_corvette.json');
const vendorPath = path.join(root, 'js', 'vendor', 'three.min.js');
const outputPath = path.join(root, 'generated', 'comfyui', 'input', 'trellis2_teaser_ship_source.png');
const model = JSON.parse(await fs.readFile(modelPath, 'utf8'));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: vendorPath });

  const metrics = await page.evaluate(({ modelJson, canvasWidth, canvasHeight }) => {
    document.body.style.margin = '0';
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    document.body.append(canvas);

    const background = [244, 247, 250];
    const context = canvas.getContext('2d');
    context.fillStyle = `rgb(${background.join(',')})`;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    const camera = new THREE.PerspectiveCamera(32, canvasWidth / canvasHeight, 0.01, 1000);
    const ship = new THREE.ObjectLoader().parse(modelJson);
    let meshCount = 0;
    ship.traverse((node) => {
      if (!node.isMesh) return;
      meshCount += 1;
      node.material = new THREE.MeshStandardMaterial({
        color: 0x71879a,
        metalness: 0.62,
        roughness: 0.34,
      });
    });
    if (!meshCount) throw new Error('The Corvette descriptor has no meshes.');

    ship.rotation.set(-0.15, 0.45, 0.12);
    ship.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(ship);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z);
    ship.position.sub(center);
    ship.updateMatrixWorld(true);

    camera.position.set(radius * 2.7, radius * 2.1, radius * 3.1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const lightDirection = new THREE.Vector3(-0.35, 0.75, 0.58).normalize();
    const triangles = [];
    let triangleCount = 0;
    const project = (point) => {
      const viewPoint = point.clone().applyMatrix4(camera.matrixWorldInverse);
      const depth = -viewPoint.z;
      if (depth <= camera.near || depth >= camera.far) return null;
      const ndc = point.clone().project(camera);
      if (Math.abs(ndc.x) > 1.2 || Math.abs(ndc.y) > 1.2) return null;
      return {
        x: (ndc.x * 0.5 + 0.5) * canvasWidth,
        y: (1 - (ndc.y * 0.5 + 0.5)) * canvasHeight,
        depth,
      };
    };

    ship.traverse((node) => {
      if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
      const positions = node.geometry.getAttribute('position');
      const indices = node.geometry.index;
      const count = indices ? indices.count : positions.count;
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const indexA = indices ? indices.getX(offset) : offset;
        const indexB = indices ? indices.getX(offset + 1) : offset + 1;
        const indexC = indices ? indices.getX(offset + 2) : offset + 2;
        const a = new THREE.Vector3().fromBufferAttribute(positions, indexA).applyMatrix4(node.matrixWorld);
        const b = new THREE.Vector3().fromBufferAttribute(positions, indexB).applyMatrix4(node.matrixWorld);
        const c = new THREE.Vector3().fromBufferAttribute(positions, indexC).applyMatrix4(node.matrixWorld);
        const projected = [project(a), project(b), project(c)];
        if (projected.some((point) => point === null)) continue;
        const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        const brightness = 0.34 + Math.abs(normal.dot(lightDirection)) * 0.58;
        const color = node.material.color;
        const fill = [color.r, color.g, color.b]
          .map((channel) => Math.round(Math.min(255, channel * brightness * 255)));
        triangles.push({
          points: projected,
          depth: projected.reduce((sum, point) => sum + point.depth, 0) / 3,
          fill: `rgb(${fill.join(',')})`,
        });
        triangleCount += 1;
      }
    });

    triangles.sort((left, right) => right.depth - left.depth);
    for (const triangle of triangles) {
      const [a, b, c] = triangle.points;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.closePath();
      context.fillStyle = triangle.fill;
      context.fill();
      context.strokeStyle = 'rgba(24, 42, 56, 0.16)';
      context.lineWidth = 0.65;
      context.stroke();
    }

    const pixels = context.getImageData(0, 0, canvasWidth, canvasHeight).data;
    let foregroundPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.abs(pixels[index] - background[0]) + Math.abs(pixels[index + 1] - background[1])
        + Math.abs(pixels[index + 2] - background[2]) > 40) foregroundPixels += 1;
    }

    return {
      meshCount,
      triangleCount,
      bounds: size.toArray(),
      foregroundPixels,
    };
  }, { modelJson: model, canvasWidth: width, canvasHeight: height });

  if (metrics.foregroundPixels < 1000) {
    throw new Error(`Rendered ship is blank (${metrics.foregroundPixels} foreground pixels).`);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await page.locator('canvas').screenshot({ path: outputPath });
  console.log(JSON.stringify({ outputPath, ...metrics }));
} finally {
  await browser.close();
}