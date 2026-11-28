"""Execute the canonical data-only validator with no host bindings, in bounded QuickJS."""
import json
from pathlib import Path
from admin_identity import FamilyError
ROOT=Path(__file__).resolve().parents[1]

def context():
    import quickjs
    ctx=quickjs.Context()
    ctx.set_memory_limit(32*1024*1024)
    ctx.set_max_stack_size(512*1024)
    ctx.set_time_limit(2)
    ctx.eval("var window={}; if(!Object.hasOwn) Object.hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);")
    ctx.eval((ROOT/"activity-engine.js").read_text(encoding="utf-8"))
    return ctx

def validate(content):
    try:
        raw=json.dumps(content,ensure_ascii=True,allow_nan=False)
        if len(raw.encode())>262144:raise FamilyError(400,"Draft too large.")
        ctx=context()
        ctx.eval((ROOT/"content-schema.js").read_text(encoding="utf-8"))
        # Input is passed as data through the function argument, never interpolated into source.
        result=ctx.eval("(s)=>JSON.stringify(window.LoloContentSchema.validate(JSON.parse(s)))")(raw)
        value=json.loads(result)
        if not isinstance(value.get("valid"),bool) or not isinstance(value.get("issues"),list):raise ValueError()
        return value
    except FamilyError:raise
    except Exception:raise FamilyError(503,"Content validator unavailable.") from None

def library():
    try:
        ctx=context()
        ctx.eval((ROOT/"activity-pilot.js").read_text(encoding="utf-8"))
        ctx.eval("var module={exports:{}};function require(p){if(p==='../activity-engine.js')return window.LoloActivities;if(p==='../activity-pilot.js')return window.LoloActivityPilot;throw Error('Denied dependency');}")
        ctx.eval((ROOT/"admin-src/activity-library.cjs").read_text(encoding="utf-8"))
        result=json.loads(ctx.eval("JSON.stringify({audit:module.exports.audit(),entries:module.exports.query()})"))
        if not result["audit"]["valid"]:raise ValueError()
        return result["entries"]
    except Exception:raise FamilyError(503,"Activity Library unavailable.") from None
