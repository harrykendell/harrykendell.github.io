#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const imageDir = path.join(rootDir, "imgs");
const sectionsDir = path.join(rootDir, "sections");
const imageManifestPath = path.join(imageDir, "image-manifest.json");
const sectionManifestPath = path.join(sectionsDir, "section-manifest.json");
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);

async function main() {
  const images = await collectImages();
  const sections = await collectSections();

  await fs.writeFile(
    imageManifestPath,
    `${JSON.stringify({ images }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    sectionManifestPath,
    `${JSON.stringify({ sections }, null, 2)}\n`,
    "utf8",
  );

  console.log(`Generated ${path.relative(rootDir, imageManifestPath)} (${images.length} images).`);
  console.log(`Generated ${path.relative(rootDir, sectionManifestPath)} (${sections.length} sections).`);
}

async function collectImages() {
  const files = await collectFiles(imageDir);
  return files
    .filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => toPosixPath(path.relative(rootDir, filePath)))
    .filter((filePath) => filePath !== "imgs/image-manifest.json")
    .sort((left, right) => left.localeCompare(right));
}

async function collectSections() {
  const files = await collectFiles(sectionsDir);
  return files
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".md")
    .map((filePath) => toPosixPath(path.relative(sectionsDir, filePath)))
    .filter((filePath) => filePath !== "section-order.md")
    .map((filePath) => filePath.replace(/\.md$/i, ""))
    .filter((sectionId) => sectionId !== "supplement/introduction")
    .sort((left, right) => left.localeCompare(right));
}

async function collectFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absPath);
    }
  }
  return files;
}

function toPosixPath(value) {
  return String(value).split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
