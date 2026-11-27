import unittest
import uuid
from progress_sync import VERSION, InvalidProgress, validate_snapshot, validate_write


class ProgressValidationTests(unittest.TestCase):
    def test_path_validation_and_minimal_data(self):
        path={"schemaVersion":1,"scope":"unit","programId":"foundation","unitId":"hello","lessonId":None,
              "curriculumVersion":VERSION,"lessonIds":["hello-1","hello-2","hello-3","hello-4"],
              "skippedLessonIds":[],"currentIndex":1,"status":"ready"}
        snapshot={"schemaVersion":1,"curriculumVersion":VERSION,"completedLessonIds":["hello-1"],"path":path}
        self.assertEqual(validate_snapshot(snapshot),snapshot)
        for invalid in [
            {**snapshot,"audio":"forbidden"}, {**snapshot,"curriculumVersion":"old"},
            {**snapshot,"completedLessonIds":["hello-1","hello-1"]},
            {**snapshot,"completedLessonIds":[{"id":"hello-1"}]},
            {**snapshot,"path":{**path,"currentIndex":True}},
            {**snapshot,"path":{**path,"lessonIds":["hello-1","class-1"]}},
            {**snapshot,"path":{**path,"status":"completed"}},
            {**snapshot,"path":{**path,"programId":[]}},
        ]:
            with self.assertRaises(InvalidProgress):
                validate_snapshot(invalid)
        with self.assertRaises(InvalidProgress):
            validate_write(True,str(uuid.uuid4()),snapshot)
