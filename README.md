# Tutor Dashboard

A tutoring dashboard in plain HTML, CSS and JavaScript. No backend, no logins. Data is saved in the browser with localStorage.

- `index.html`: tutor dashboard (topics, session log, parent updates, next-session planner, practice, scores, progress, student links)
- `student.html`: student dashboard, opened from the link the tutor shares

## Running it

- **On one device:** open `index.html` in any browser.
- **On any device:** turn on GitHub Pages (Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`). The site will be at `https://<your-username>.github.io/<repo-name>/`.

## Moving data between devices

- **Your own devices:** use **Backup → Export backup file** on one device, then **Import backup file** on the other.
- **Students:** on the **Student link** tab, copy the link and send it. It holds only that student's topics, status, assigned practice and last-session recap. Your notes, scores and other students are never included. Send a fresh link after you log a session or assign practice.
- **Back from students:** the student taps **Copy check-in code** and texts it to you. Paste it on the **Student link** tab to bring in their drill results, confidence ratings and finished assignments.
