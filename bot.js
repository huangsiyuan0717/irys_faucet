const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');

// === 配置 ===
const API_KEY = '';
const SITE_KEY = '0x4AAAAAAA6vnrvBCtS4FAl-';
const WEBSITE_URL = 'https://irys.xyz/faucet';
const PROXY_API_URL = '';
const MAX_RETRIES = 3;

// === 读取地址 ===
const addresses = fs.readFileSync('address.txt', 'utf-8').trim().split('\n');

// === 获取代理 ===
async function getProxy() {
  try {
    const response = await axios.get(PROXY_API_URL);
    console.log('API 响应:', response.data);
    const proxy = 'http://' + response.data; // 添加 http:// 前缀
    // 验证代理字符串格式
    if (!proxy.includes('@') || !proxy.includes(':')) {
      console.error('❌ 代理字符串格式无效:', proxy);
      return null;
    }
    return proxy;
  } catch (err) {
    console.error('❌ 获取代理失败:', err.message);
    return null;
  }
}

// === 创建 CAPTCHA 任务 ===
async function createCaptchaTask(wallet, proxy) {
  try {
    const axiosProxy = axios.create({
      httpsAgent: new HttpsProxyAgent(proxy)
    });

    const { data: taskRes } = await axiosProxy.post('https://api.yescaptcha.com/createTask', {
      clientKey: API_KEY,
      task: {
        type: 'TurnstileTaskProxyless',
        websiteURL: WEBSITE_URL,
        websiteKey: SITE_KEY
      }
    });

    if (!taskRes.taskId) {
      console.error(`❌ 创建 CAPTCHA 失败 - ${wallet}`);
      console.error('返回内容：', taskRes);
      return null;
    }
    return taskRes.taskId;
  } catch (err) {
    console.error(`❌ 创建 CAPTCHA 任务出错 - ${wallet}:`, err.message);
    return null;
  }
}

// === 轮询 CAPTCHA 结果 ===
async function getCaptchaResult(taskId, wallet) {
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const { data: res } = await axios.post('https://api.yescaptcha.com/getTaskResult', {
      clientKey: API_KEY,
      taskId
    });

    if (res.status === 'ready') return res.solution.token;
    else console.log(`⏳ 等待 CAPTCHA：${wallet}`);
  }
}

// === 请求 Faucet ===
async function requestFaucet(wallet, token, proxy) {
  const client = axios.create({
    httpsAgent: new HttpsProxyAgent(proxy),
    headers: {
      'Content-Type': 'application/json',
      'Origin': WEBSITE_URL,
      'Referer': WEBSITE_URL,
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const res = await client.post('https://irys.xyz/api/faucet', {
    captchaToken: token,
    walletAddress: wallet
  });

  return res.data;
}

// === 处理单个地址 ===
async function processWallet(wallet, attempt = 1) {
  if (attempt > MAX_RETRIES) {
    console.error(`❌ ${wallet} 重试${MAX_RETRIES}次后失败，跳过`);
    return;
  }

  console.log(`🚀 开始领取：${wallet} (尝试 ${attempt}/${MAX_RETRIES})`);

  const proxy = await getProxy();
  if (!proxy) {
    console.error(`❌ ${wallet} 获取代理失败，将重试`);
    await new Promise(r => setTimeout(r, 2000)); // 等待2秒后重试
    return processWallet(wallet, attempt + 1);
  }

  // 隐藏用户名和密码，仅显示 host:port
  const proxyDisplay = proxy.replace(/http:\/\/[^@]+@/, 'http://');
  console.log(`使用代理：${proxyDisplay}`);

  try {
    const taskId = await createCaptchaTask(wallet, proxy);
    if (!taskId) {
      console.error(`❌ ${wallet} 创建CAPTCHA任务失败，将重试`);
      await new Promise(r => setTimeout(r, 2000));
      return processWallet(wallet, attempt + 1);
    }

    const captchaToken = await getCaptchaResult(taskId, wallet);
    const result = await requestFaucet(wallet, captchaToken, proxy);

    // 检查返回消息是否包含无需重试的字符串
    if (result.message && typeof result.message === 'string') {
      console.log("result message:", result.message)
      if (result.message.includes('Already redeemed today') ) {
        console.log(`⚠️ ${wallet}：${result.message}，无需重试，直接跳到下一个地址`);
        return; // 直接返回，不重试
      }
    }

    console.log(`✅ 成功领取 ${wallet}：`, result.message);
  } catch (err) {
    const errorMessage = err.response && err.response.data && err.response.data.message || err.message || '';
    if (typeof errorMessage === 'string' && 
        (errorMessage.includes('Already redeemed today') )) {
      console.log(`⚠️ ${wallet}：${errorMessage}，无需重试，直接跳到下一个地址`);
      return; // 直接返回，不重试
    }
    console.error(`❌ ${wallet} 出错：`, err.response ? err.response.data : err.message);
    console.error(`将在2秒后重试 (${attempt}/${MAX_RETRIES})`);
    await new Promise(r => setTimeout(r, 2000));
    return processWallet(wallet, attempt + 1);
  }
}

// === 主流程 ===
async function runFaucet() {
  for (const wallet of addresses) {
    await processWallet(wallet.trim());
    console.log('-----------------------------');
    await new Promise(r => setTimeout(r, 1000)); // 每个钱包之间等待1秒
  }
}

// === 调度任务 (每24.5小时运行一次) ===
function scheduleFaucet() {
  runFaucet(); // 立即运行一次
  setInterval(runFaucet, 24.5 * 60 * 60 * 1000); // 每24.5小时运行一次
}

// === 启动 ===
console.log('启动 faucet 调度器...');
scheduleFaucet();