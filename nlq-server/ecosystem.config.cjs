module.exports = {
  apps: [
    {
      name: 'nlq-server',
      script: 'server.mjs',
      cwd: '/home/user/webapp/nlq-server',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '500M',
    }
  ]
}
