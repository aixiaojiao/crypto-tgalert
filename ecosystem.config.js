module.exports = {
  apps: [{
    name: 'crypto-tgalert',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    
    // PM2 配置
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'data'],
    
    // 日志配置
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 自动重启配置
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '500M',
    
    // 重启延迟
    restart_delay: 4000,
    
    // 监听文件变化重启 (生产环境关闭)
    watch: false,
    
    // 环境变量
    env_file: '.env',
    
    // 其他配置
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    
    // 健康检查
    health_check_http: false,
    
    // 集群模式下的配置 (当前为fork模式，不适用)
    // instances: 'max',
    // exec_mode: 'cluster'
  }],

  // 部署配置 (可选)
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-server-ip',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/crypto-tgalert.git',
      path: '/home/ubuntu/crypto-tgalert',
      'pre-deploy-local': '',
      'post-deploy': 'npm install --production && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};