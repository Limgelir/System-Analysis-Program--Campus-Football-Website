const {test}=require('node:test');const assert=require('node:assert/strict');
const {canonicalAccount,POLICY,sendLoginError}=require('../services/loginSecurityService');
test('登录账号键规范化大小写和重音；锁定策略有明确短时边界',()=>{
  assert.equal(canonicalAccount(' TEST-É '),canonicalAccount('test-e'));
  assert.equal(POLICY.pairLimit,5);assert.equal(POLICY.accountLimit,20);assert.equal(POLICY.lockMs,300000);
});
test('登录内部错误不暴露 SQL 或敏感数据',()=>{
  let result;const res={status(n){assert.equal(n,503);return this},json(x){result=x}};
  sendLoginError(res,new Error('SQL password=private JWT=private'));assert.equal(result.message,'登录服务暂不可用，请稍后再试');
});
