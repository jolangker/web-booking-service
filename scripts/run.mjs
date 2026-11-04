import { spawn } from 'node:child_process'

const commands = {
  dev: ['--parallel', '--filter', '@booking/web', '--filter', '@booking/worker', 'dev'],
  web: ['--filter', '@booking/web', 'dev'],
  worker: ['--filter', '@booking/worker', 'dev'],
  migrate: ['--filter', '@booking/db', 'migrate'],
  generate: ['--filter', '@booking/db', 'generate'],
}
const command = commands[process.argv[2]]
if (!command) throw new Error('Unknown runtime command')
function pnpm(args) {
  return spawn(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit' })
}
const build = pnpm(['build:packages'])
build.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1)
  const child = pnpm(command)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', code => process.exit(code ?? 0))
})
