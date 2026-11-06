import fs from 'node:fs';

const credPath = process.argv[2];
const repoName = process.argv[3] ?? 'vrm-poser';
const isPrivate = (process.argv[4] ?? 'true') === 'true';

const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const H = {
  Authorization: `token ${cred.token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'dsh-vrm-poser',
  'Content-Type': 'application/json',
};

const me = await fetch('https://api.github.com/user', { headers: H });
if (!me.ok) {
  console.log('AUTH_FAIL', me.status);
  process.exit(1);
}
const user = await me.json();
console.log('account:', user.login);

const existing = await fetch(`https://api.github.com/repos/${user.login}/${repoName}`, { headers: H });
if (existing.status === 200) {
  const repo = await existing.json();
  console.log('REPO_EXISTS', repo.html_url, repo.clone_url);
  process.exit(0);
}

const created = await fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    name: repoName,
    private: isPrivate,
    description: 'VRM 姿势台：PMX/VRM 加载、姿势库、图片转姿势（MediaPipe）、姿势画廊',
    auto_init: false,
  }),
});
if (!created.ok) {
  console.log('CREATE_FAIL', created.status, (await created.text()).slice(0, 300));
  process.exit(1);
}
const repo = await created.json();
console.log('CREATED', repo.html_url);
console.log('CLONE', repo.clone_url);
console.log('OWNER', user.login);
console.log('EMAIL', `${user.id}+${user.login}@users.noreply.github.com`);
