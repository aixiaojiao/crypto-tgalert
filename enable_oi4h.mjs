
import { triggerAlertService } from './dist/services/triggerAlerts.js';

async function enableOI4h() {
  try {
    console.log('Starting OI4h monitoring...');
    await triggerAlertService.startOI4hMonitoring();
    console.log('OI4h monitoring enabled');
    
    // 等待几分钟让它运行
    setTimeout(() => {
      console.log('Stopping monitoring...');
      triggerAlertService.stopOI4hMonitoring();
      process.exit(0);
    }, 120000); // 2分钟
  } catch (error) {
    console.error('Error:', error);
  }
}

enableOI4h();
