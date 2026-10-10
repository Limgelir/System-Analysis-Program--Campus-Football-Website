export const device = process.env.E2E_MOBILE === '1'
  ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 1000 } }
