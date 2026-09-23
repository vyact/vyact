const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const electronDir = path.resolve(__dirname, "..");
const packageConfigs = [
    path.join(electronDir, "package.json"),
    path.resolve(electronDir, "../win/electron/package.json"),
];

for (const configPath of packageConfigs) {
    const packageConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const includedFiles = new Set(packageConfig.build.files);
    const visitedFiles = new Set();

    function checkLocalModules(fileName) {
        if (visitedFiles.has(fileName)) return;
        visitedFiles.add(fileName);
        assert(includedFiles.has(fileName), `${configPath}: ${fileName} is missing from build.files`);

        const source = fs.readFileSync(path.join(electronDir, fileName), "utf8");
        for (const match of source.matchAll(/require\(["'](\.\/.+?)["']\)/g)) {
            const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(fileName), match[1]));
            checkLocalModules(path.posix.extname(dependency) ? dependency : `${dependency}.js`);
        }
    }

    checkLocalModules(packageConfig.main);
}
