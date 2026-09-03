const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const metadataPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(rootDir, "dist", "latest-mac.yml");
const yaml = require(path.join(rootDir, "electron", "node_modules", "js-yaml"));

const metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
const zipFile = metadata?.files?.find(file => typeof file.url === "string" && file.url.endsWith(".zip"));

if (!zipFile?.sha512 || !Number.isFinite(zipFile.size)) {
    throw new Error(`A valid macOS update ZIP entry was not found in ${metadataPath}`);
}

const zipPath = path.join(path.dirname(metadataPath), zipFile.url);
const zipSize = fs.statSync(zipPath).size;
const zipSha512 = crypto.createHash("sha512").update(fs.readFileSync(zipPath)).digest("base64");
if (zipSize !== zipFile.size || zipSha512 !== zipFile.sha512) {
    throw new Error(`macOS update ZIP does not match its metadata: ${zipPath}`);
}

metadata.files = [zipFile];
metadata.path = zipFile.url;
metadata.sha512 = zipFile.sha512;
fs.writeFileSync(metadataPath, yaml.dump(metadata, {lineWidth: -1, noRefs: true}), "utf8");

for (const fileName of fs.readdirSync(path.dirname(metadataPath))) {
    if (fileName.endsWith(".dmg.blockmap")) {
        fs.rmSync(path.join(path.dirname(metadataPath), fileName));
    }
}

console.log(`Finalized macOS update metadata with ZIP target: ${zipFile.url}`);
