# Working in this repo

See [`README.md`](README.md) for the layout convention, the Plethora contract
endpoints, and the accumulated validator and rendering gotchas. Read it before
writing a bit — several of those notes were expensive to learn.

## `_skills/` is opt-in

**Do not use anything in [`_skills/`](_skills) unless the repository owner asks
for it by name.** That includes [`_skills/sekai/`](_skills/sekai), its scripts,
and its harness.

This holds even when a task looks exactly like what a skill covers — a Sekai
link, a request to port or convert something, a request to build a bit. None of
those are an invitation. Do the work directly, and at most mention in passing
that the skill exists.

The reason: a skill that triggers on its own has decided how a piece of work
gets done before the owner had a say in it. They would rather make that call
each time. Treat "would this skill help here?" as a question for them, not for
you.

Reading is fine and encouraged — `_skills/sekai/references/gotchas.md` records
real traps, and there is no sense repeating a documented mistake. What needs
asking is *following* a skill as the method for a task.
