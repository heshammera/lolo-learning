const fs = require('node:fs');
const path = require('node:path');
const {validateCurriculum} = require('../curriculum-engine.js');

const curriculumPath = path.resolve(__dirname, '..', process.argv[2] || 'curriculum.json');
let curriculum;
try {
  curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));
} catch (error) {
  process.stderr.write(`Cannot read curriculum JSON: ${error.message}\n`);
  process.exit(2);
}

const result = validateCurriculum(curriculum);
process.stdout.write(`Curriculum check: ${result.counts.programs} programs, ${result.counts.units} units, ${result.counts.lessons} lessons, ${result.counts.skills} skills.\n`);
for (const item of result.errors) process.stderr.write(`ERROR ${item.code} ${item.path}: ${item.message}\n`);
const warningCounts = result.warnings.reduce((counts, item) => ({...counts, [item.code]: (counts[item.code] || 0) + 1}), {});
for (const [code, count] of Object.entries(warningCounts)) process.stdout.write(`WARNING ${code}: ${count} item(s) need authoring.\n`);
process.exit(result.valid ? 0 : 1);
