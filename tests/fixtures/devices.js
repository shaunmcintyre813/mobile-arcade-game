// Samsung Galaxy S25 Ultra profile & mobile device matrix
export const GalaxyS25Ultra = {
  name: 'Samsung Galaxy S25 Ultra',
  userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
  viewport: {
    width: 412,
    height: 915
  },
  deviceScaleFactor: 3.5,
  isMobile: true,
  hasTouch: true,
  defaultBrowserType: 'chromium'
};

export const DeviceMatrix = [
  GalaxyS25Ultra,
  {
    name: 'iPhone 15 Pro',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3.0,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: 'chromium'
  },
  {
    name: 'Compact Android (16:9)',
    userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-A105F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 2.0,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: 'chromium'
  }
];
