"""Versioned progress snapshot validation and optimistic concurrency, staging only."""
import json
import uuid
from pathlib import Path

CURRICULUM = json.loads((Path(__file__).resolve().parent / "curriculum.json").read_text(encoding="utf-8"))
VERSION = CURRICULUM["curriculumVersion"]
PROGRAMS = {"foundation": CURRICULUM["units"], **{p["id"]:p["units"] for p in CURRICULUM.get("programs",[]) if p.get("status") not in ("draft","archived")}}
LESSON_IDS = frozenset(l["id"] for units in PROGRAMS.values() for u in units for l in u["lessons"])
MAX_REVISION = 9007199254740990
SNAPSHOT_FIELDS = {"schemaVersion","curriculumVersion","completedLessonIds","path"}
PATH_FIELDS = {"schemaVersion","scope","programId","unitId","lessonId","curriculumVersion","lessonIds","skippedLessonIds","currentIndex","status"}


class InvalidProgress(ValueError):
    pass


def require(condition):
    if not condition:
        raise InvalidProgress("بيانات التقدم غير صالحة أو إصدار المنهج مختلف.")


def uuid_value(value):
    require(isinstance(value,str))
    try:
        result = uuid.UUID(value)
    except ValueError:
        raise InvalidProgress("معرّف العملية أو الملف غير صالح.") from None
    require(str(result)==value)
    return result


def id_list(value):
    require(isinstance(value,list) and len(value)<=len(LESSON_IDS))
    require(all(isinstance(item,str) and item in LESSON_IDS for item in value))
    require(len(set(value))==len(value))
    return value


def validate_snapshot(value):
    require(isinstance(value,dict) and set(value)==SNAPSHOT_FIELDS)
    require(type(value["schemaVersion"]) is int and value["schemaVersion"]==1 and value["curriculumVersion"]==VERSION)
    completed = sorted(id_list(value["completedLessonIds"]))
    path = value["path"]
    if path is not None:
        require(isinstance(path,dict) and set(path)==PATH_FIELDS)
        require(type(path["schemaVersion"]) is int and path["schemaVersion"]==1 and path["curriculumVersion"]==VERSION)
        scope,program,unit,lesson = (path[k] for k in ("scope","programId","unitId","lessonId"))
        require(isinstance(scope,str) and scope in ("lesson","unit","curriculum") and isinstance(program,str) and program in PROGRAMS)
        require(unit is None if scope=="curriculum" else isinstance(unit,str))
        require(isinstance(lesson,str) if scope=="lesson" else lesson is None)
        selected=[l["id"] for u in PROGRAMS[program] if scope=="curriculum" or u["id"]==unit for l in u["lessons"] if scope!="lesson" or l["id"]==lesson]
        require(bool(selected) and (scope!="lesson" or len(selected)==1))
        ids,skipped=id_list(path["lessonIds"]),id_list(path["skippedLessonIds"])
        require(set(skipped).issubset(selected) and (scope!="lesson" or not skipped))
        require(ids==[x for x in selected if x not in skipped])
        index=path["currentIndex"]
        require(type(index) is int and 0<=index<=len(ids))
        require(path["status"]==("completed" if index==len(ids) else "ready"))
        path=dict(path)
    return {"schemaVersion":1,"curriculumVersion":VERSION,"completedLessonIds":completed,"path":path}


def validate_write(revision, operation, snapshot):
    require(type(revision) is int and 0<=revision<MAX_REVISION)
    return revision,uuid_value(operation),validate_snapshot(snapshot)
