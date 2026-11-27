const fs = require('node:fs');
const path = require('node:path');

const curriculumPath = path.resolve(__dirname, '..', 'curriculum.json');
const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));

if (curriculum.schemaVersion && curriculum.schemaVersion > 2) {
  throw new Error(`Cannot migrate unsupported schema version ${curriculum.schemaVersion}.`);
}

curriculum.schemaVersion = 2;
curriculum.curriculumVersion ||= '2.0.0';
curriculum.subjects ||= [
  {id: 'english', title: 'English'},
  {id: 'mathematics', title: 'Mathematics'},
];
curriculum.skills ||= [];
const knownSkills = new Map(curriculum.skills.map(skill => [skill.id, skill]));
const migratedPrograms = curriculum.programs || [];
for (const program of migratedPrograms) {
  if (program.subjectId === 'math') program.subjectId = 'mathematics';
  if (!program.subjectId) {
    if (program.subject === 'math') program.subjectId = 'mathematics';
    else if (program.id === 'connect-plus-1') program.subjectId = 'english';
    else throw new Error(`Add an explicit subjectId before migrating program ${program.id}.`);
  }
}
const programs = [
  {id: 'foundation', subjectId: 'english', units: curriculum.units || []},
  ...migratedPrograms,
];
curriculum.strands ||= [...new Set(programs.flatMap(program => (program.units || []).flatMap(unit => unit.lessons || []).map(lesson => lesson.strand).filter(Boolean)))];

for (const program of programs) {
  for (const unit of program.units || []) {
    for (const lesson of unit.lessons || []) {
      lesson.version ||= '1.0.0';
      lesson.subjectId = program.subjectId;
      const skillId = `${program.id}:${lesson.id}`;
      lesson.skillIds = [...new Set([...(lesson.skillIds || []), skillId])];
      let skill = knownSkills.get(skillId);
      if (!skill) {
        skill = {
          id: skillId,
          title: lesson.title || lesson.focus,
          subjectId: program.subjectId,
          lessonIds: [],
          prerequisiteSkillIds: [],
        };
        curriculum.skills.push(skill);
        knownSkills.set(skillId, skill);
      }
      skill.subjectId = program.subjectId;
      if (!skill.lessonIds.includes(lesson.id)) skill.lessonIds.push(lesson.id);
    }
  }
}

curriculum.versionHistory ||= [{
  version: curriculum.curriculumVersion,
  date: new Date().toISOString().slice(0, 10),
  note: 'Added versioned curriculum metadata and stable lesson-to-skill references without changing lesson ids or content.',
}];
fs.writeFileSync(curriculumPath, `${JSON.stringify(curriculum, null, 2)}\n`);
process.stdout.write(`Migrated ${programs.reduce((count, program) => count + program.units.reduce((unitCount, unit) => unitCount + unit.lessons.length, 0), 0)} lessons to curriculum schema v2.\n`);
