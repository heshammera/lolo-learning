const fs = require('node:fs');
const path = require('node:path');

const curriculumPath = path.resolve(__dirname, '..', 'curriculum.json');
const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));
const lessons = new Map([
  ...(curriculum.units || []).flatMap(unit => unit.lessons || []),
  ...(curriculum.programs || []).flatMap(program => (program.units || []).flatMap(unit => unit.lessons || [])),
].map(lesson => [lesson.id, lesson]));

curriculum.evidenceTypes ||= [];
if (!curriculum.evidenceTypes.includes('recognized_token_match')) curriculum.evidenceTypes.push('recognized_token_match');
for (const skill of curriculum.skills || []) {
  const lesson = lessons.get(skill.lessonIds?.[0]);
  if (!lesson) throw new Error(`Cannot locate lesson for skill ${skill.id}.`);
  skill.title = `ترديد محتوى اللوحة: ${lesson.title || lesson.focus}`;
  skill.evidenceType = 'recognized_token_match';
}

if (curriculum.curriculumVersion === '2.0.0') {
  curriculum.curriculumVersion = '2.1.0';
  curriculum.versionHistory ||= [];
  curriculum.versionHistory.push({
    version: '2.1.0',
    date: new Date().toISOString().slice(0, 10),
    note: 'Clarified lesson skill evidence as recognized-token repetition; does not claim pronunciation or full lesson mastery.',
  });
}

fs.writeFileSync(curriculumPath, `${JSON.stringify(curriculum, null, 2)}\n`);
process.stdout.write(`Prepared ${curriculum.skills.length} recognized-token repetition skills for curriculum ${curriculum.curriculumVersion}.\n`);
