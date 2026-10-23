You are finishing a git merge of the target branch `{{TARGET}}` into the task branch `{{FEATURE}}`. The merge is already in progress in the current directory (the task's worktree) and stopped on conflicts. Your job is to resolve every conflict so the merged code keeps BOTH:

- the task's intent (what the task branch set out to do, described in the task spec below), and
- everything `{{TARGET}}` added since the task branched off (other people's work must not be lost).

## How to work

1. Read the task spec and look at what the task changed (`git diff {{MERGE_BASE}} HEAD --stat`, and the diff of a file when you need it) and what `{{TARGET}}` changed (`git diff {{MERGE_BASE}} MERGE_HEAD --stat`). `git log --oneline {{MERGE_BASE}}..MERGE_HEAD` lists the target's commits.
2. Resolve each conflicted file listed below, by its conflict type:
   - **Deleted by the task, changed on `{{TARGET}}`** (modify/delete): if the task deliberately removed the file (the spec or the task's diff shows it is removing that feature/module), keep it deleted (`git rm <file>`). Then check whether `{{TARGET}}`'s changes to it are needed elsewhere: new callers, imports, registrations, routes, tests or references that `{{TARGET}}` added to code the task removed. Adapt those so the code compiles and keeps working without the removed code. If the deletion was incidental (not part of the task's intent), keep the file with `{{TARGET}}`'s changes (`git checkout --theirs <file>` then `git add <file>`) and make sure it still fits the task's changes.
   - **Changed by the task, deleted on `{{TARGET}}`**: `{{TARGET}}` removed or moved it on purpose. Usually move the task's change to wherever the code now lives (search for it) and keep the file deleted; keep the file only if the task's change cannot live anywhere else.
   - **Both changed**: merge both sides by meaning, not by picking one. Keep the task's changes and `{{TARGET}}`'s changes; where they truly contradict, the task's intent wins for what the task is about, `{{TARGET}}` wins for everything else.
   - **Added on both sides**: combine the two versions into one file.
3. Remove every conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`). Not one may remain in any file.
4. `git add` each resolved file (and `git rm` files you keep deleted). If you create a new file, `git add` it too.
5. Run the verify command (below) and fix what the merge broke: compile errors, broken imports, tests that fail because of how the two sides combine. Fix only merge fallout. No unrelated refactors, no new features, no reformatting. If dependencies are missing, install them the way the project does (for example `npm install`) before verifying. Re-run until it passes, or until you are sure the failure is not caused by the merge.

## Rules

- Do NOT commit, do NOT run `git merge --continue`, `git merge --abort`, `git reset`, `git rebase`, `git stash`, `git checkout <branch>` or anything else that changes git history or the current branch. Do NOT push. Malvy commits the merge after checking your work.
- Work only inside the current directory.
- If you cannot resolve the merge sensibly (the two sides are incompatible in a way that needs a human decision), stop and report `failed` with the reason.

## Output

Finish with exactly one block, as the last thing you write:

<merge_result>{"status":"resolved","notes":"<one or two sentences: what you kept deleted, what you adapted, anything a reviewer should look at>","verify":"passed"}</merge_result>

- `status`: `resolved` when every conflict is resolved and staged, otherwise `failed`.
- `verify`: `passed` or `failed` for the last verify run, `none` when there is no verify command.
