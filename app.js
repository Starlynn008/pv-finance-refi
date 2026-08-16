(function () {
  'use strict';

  /* ============ 计算模型（纯函数，可 node 测试） ============ */
  // ppy = 每年还款次数（月=12，季=4）
  function pmt(annualRate, nper, pv, ppy) {
    const r = annualRate / 100 / (ppy || 12);
    if (r === 0) return pv / nper;
    return pv * r / (1 - Math.pow(1 + r, -nper));
  }
  function schedule(annualRate, nper, pv, mode, ppy) {
    const per = ppy || 12;
    const r = annualRate / 100 / per;
    const rows = [];
    let bal = pv;
    const pPer = mode === 'epp' ? pv / nper : 0;
    for (let i = 1; i <= nper; i++) {
      const interest = bal * r;
      let principal, pay;
      if (mode === 'epp') { principal = pPer; pay = principal + interest; }
      else { pay = pmt(annualRate, nper, pv, per); principal = pay - interest; }
      bal -= principal;
      if (Math.abs(bal) < 1e-9) bal = 0;
      rows.push({ interest, principal, pay, bal });
    }
    return rows;
  }
  function yearPI(rows, y, ppy) {
    const p = ppy || 12;
    let s = 0; const a = (y - 1) * p, b = Math.min(y * p, rows.length);
    for (let i = a; i < b; i++) s += rows[i].pay;
    return s;
  }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

  function computeModel(inp) {
    // 费率参数带默认值（清空表单后仍可算）
    const newRate = inp.newRate || 4;
    const svcRate = inp.svcRate || 5;
    const evalFee = inp.evalFee || 0;
    const mgmtRate = inp.mgmtRate || 2.5;
    const opexRate = inp.opexRate || 1;

    const oldYears = inp.oldYears;
    const newYears = inp.newYears || inp.oldYears;
    const newAmt = inp.newAmt || inp.oldBalance;
    const newDeposit = (inp.newDeposit === '' || inp.newDeposit == null) ? inp.oldDeposit : inp.newDeposit;

    const oldPpy = 12;                                   // 原方案按月
    const newPpy = inp.newRepay === 'quarter' ? 4 : 12;  // 新方案按月/按季

    const oldRows = schedule(inp.oldRate, oldYears * 12, inp.oldAmt, inp.oldRepay === 'epp' ? 'epp' : 'emi', oldPpy);
    const newRows = schedule(newRate, newYears * newPpy, newAmt, 'emi', newPpy);

    const oldYearPI = yearPI(oldRows, 1, oldPpy);
    const oldInterest = oldRows.reduce((a, x) => a + x.interest, 0);
    const oldYearNetCF = inp.oldAnnual - oldYearPI;

    const newYearPI = yearPI(newRows, 1, newPpy);
    const newInterest = newRows.reduce((a, x) => a + x.interest, 0);

    const svc = newAmt * (svcRate / 100);
    const mgmtTotal = inp.oldAnnual * newYears * (mgmtRate / 100);
    const mgmtYear = mgmtTotal / newYears;
    const opexTotal = inp.oldMw * opexRate * newYears;
    const opexYear = opexTotal / newYears;
    const newYearActual = newYearPI + mgmtYear + opexYear;
    const newYearNetCF = inp.oldAnnual - newYearActual;

    const oldTotalCost = oldInterest + (inp.oldPenalty || 0);
    const newTotalCost = newInterest + svc + evalFee + mgmtTotal + opexTotal + (inp.newPenalty || 0);
    const costSave = oldTotalCost - newTotalCost;

    const extra = newAmt - inp.oldBalance;
    const upfrontNoDeposit = svc + evalFee + mgmtYear + opexYear;
    const surplus = extra - upfrontNoDeposit;

    // ===== 综合融资成本（全口径年化）=====
    // 口径：首年全口径支出（利息+年化服务费+年化评估费+管理费+运维费）÷ 原剩余本金 × 100%
    // 原因：客户感知的是"原来825万本金每年付出多少→置换后同样基数下付出多少"
    const oldAllInRate = inp.oldRate;  // 旧方案基本只有银行利息
    // 新方案首年利息（从还款计划第1年取，比总利息年均更反映客户即期感受）
    const newY1Interest = yearPI(newRows, 1, newPpy) - (newAmt / (newYears * newPpy)) * newPpy; // 近似：首年本息-首年本金
    // 更精确：直接从schedule取前ppy期interest求和
    let _y1Int = 0;
    for (let i = 0; i < Math.min(newPpy, newRows.length); i++) _y1Int += newRows[i].interest;
    const svcAnnual = svc / newYears;
    const evalAnnual = evalFee / newYears;
    const newY1AllIn = _y1Int + svcAnnual + evalAnnual + mgmtYear + opexYear;
    const newAllInRate = inp.oldBalance > 0 ? (newY1AllIn / inp.oldBalance * 100) : 0;
    const allInDrop = oldAllInRate > 0 ? ((oldAllInRate - newAllInRate) / oldAllInRate) : 0;

    const rateDrop = allInDrop;  // 兼容下游引用；语义改为全口径降幅

    const oldMonth = oldYearPI / 12, old3m = oldMonth * 3;
    const newQuarter = newYearPI / 4, new3m = newQuarter;
    const flowDelta3m = old3m - new3m;

    const type = (newYearNetCF > oldYearNetCF + 0.01 && costSave > 0) ? 'A' : 'B';

    return {
      oldYears, newYears, newAmt, newDeposit, newRepay: inp.newRepay,
      oldYearPI, oldInterest, oldYearNetCF,
      newYearPI, newInterest, svc, evalFee, mgmtTotal, mgmtYear, opexTotal, opexYear,
      newYearActual, newYearNetCF,
      oldTotalCost, newTotalCost, costSave,
      extra, upfrontNoDeposit, surplus, rateDrop, allInDrop,
      oldAllInRate, newAllInRate,
      oldMonth, old3m, newQuarter, new3m, flowDelta3m, type,
      newRate, oldRate: inp.oldRate, oldBalance: inp.oldBalance,
      oldMw: inp.oldMw, oldAnnual: inp.oldAnnual, oldDeposit: inp.oldDeposit,
      newPenalty: inp.newPenalty || 0, oldPenalty: inp.oldPenalty || 0
    };
  }

  /* ============ 以下仅浏览器环境执行 ============ */
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { computeModel, pmt, schedule };
    }
    return;
  }

  const WECHAT = { id: '卢林', qr: 'qr.png' }; // 微信号/名：卢林；二维码已放同目录 qr.png

  function $(id) { return document.getElementById(id); }
  function num(id) { const v = $(id).value; return v === '' ? '' : parseFloat(v); }

  function readInput() {
    return {
      custName: $('custName').value.trim(),
      projName: $('projName').value.trim(),
      oldOrg: $('oldOrg').value.trim(),
      oldMw: num('oldMw'), oldAmt: num('oldAmt'), oldBalance: num('oldBalance'),
      oldRate: num('oldRate'), oldRepay: $('oldRepay').value, oldYears: num('oldYears'),
      oldAnnual: num('oldAnnual'), oldDeposit: num('oldDeposit'), oldPenalty: num('oldPenalty'),
      newRate: num('newRate'), newYears: num('newYears'), newAmt: num('newAmt'),
      newRepay: $('newRepay').value,
      svcRate: num('svcRate'), evalFee: num('evalFee'), mgmtRate: num('mgmtRate'),
      opexRate: num('opexRate'), newDeposit: num('newDeposit'), newPenalty: num('newPenalty')
    };
  }

  function validate(inp) {
    // 文字必填字段：只判空（不能 isNaN，否则中文名误判）
    const textReq = [['custName', '客户名称'], ['projName', '项目名称']];
    // 数值必填字段：判空 + NaN
    const numReq = [['oldMw', '数量(MW)'], ['oldAmt', '融资金额'], ['oldBalance', '剩余本金'],
      ['oldRate', '原融资利率'], ['oldYears', '原融资年限'], ['oldAnnual', '年电费收入'],
      ['newAmt', '期望融资金额'], ['newYears', '期望融资年限']];
    for (const [k, n] of textReq) {
      if (inp[k] === '') return '请填写：' + n;
    }
    for (const [k, n] of numReq) {
      if (inp[k] === '' || isNaN(inp[k])) return '请填写：' + n;
    }
    return '';
  }

  let _model = null, _inp = null, _code = '';

  function generate() {
    const inp = readInput();
    const err = validate(inp);
    $('err').textContent = err;
    if (err) return;
    _model = computeModel(inp);
    _inp = inp;
    renderBrief(_model, _inp);
  }

  /* ===== 第一步：简版方案 ===== */
  function renderBrief(m, inp) {
    const repayDrop = m.oldYearPI - m.newYearPI;
    const repayDropPct = m.oldYearPI ? (repayDrop / m.oldYearPI * 100) : 0;
    const costDropPct = m.allInDrop * 100;
    const A = m.type === 'A';
    const typeTag = A ? '真实降本型' : '资金放大型';

    const html = `
      <h1>光伏电站融资置换 · 简版测算</h1>
      <div class="sub">—— ${inp.projName || '（项目名称）'}</div>
      <div class="sub">致：${inp.custName || '（客户名称）'}　|　类型：<span class="tag">${typeTag}</span></div>

      <div class="kv">
        <h2 style="border:none;margin:0 0 12px;padding:0">三项核心收益（一眼看懂）</h2>
        <div class="brief-card">
          <div class="brief-item">
            <div class="num">↓ ${f2(repayDrop)} 万</div>
            <div class="lbl2">年度还款降幅</div>
            <div class="desc">原年还款约 ${f2(m.oldYearPI)} 万 → 新约 ${f2(m.newYearPI)} 万（降幅约 ${f2(repayDropPct)}%）</div>
          </div>
          <div class="brief-item">
            <div class="num">↓ ${f2(costDropPct)}%</div>
            <div class="lbl2">综合融资成本降幅</div>
            <div class="desc">综合成本由 ${f2(m.oldAllInRate)}% 降至约 ${f2(m.newAllInRate)}%（含利息/服务费/管理费/运维等全口径）</div>
          </div>
          <div class="brief-item">
            <div class="num">+ ${f2(m.extra)} 万</div>
            <div class="lbl2">整体多融资金额</div>
            <div class="desc">置换后净余约 ${f2(m.surplus)} 万可投建新电站或补充运营</div>
          </div>
        </div>
      </div>

      <div class="cta-lock no-print">
        <h3>想看完整方案？含资金用途 / 现金流 / 落地路径 / 费用明细</h3>
        <p>填写联系方式，验证手机后即可免费获取完整版方案</p>
        <div class="grid" style="max-width:560px;margin:14px auto">
          <div class="field"><label>联系人 <b>*</b></label><input id="contactName" placeholder="您的称呼"></div>
          <div class="field"><label>手机号 <b>*</b></label><input id="contactPhone" type="tel" placeholder="11 位手机号"></div>
        </div>
        <div class="actions" style="justify-content:center">
          <button class="btn ghost" id="codeBtn" type="button">获取验证码</button>
          <input id="codeInput" placeholder="输入验证码" style="max-width:150px">
          <button class="btn" id="unlockBtn" type="button">查看完整方案</button>
        </div>
        <div class="err" id="gateErr" style="text-align:center"></div>
        <p class="hint" id="codeHint" style="text-align:center"></p>
      </div>
    `;
    $('doc').innerHTML = html;
    $('report').style.display = 'block';
    $('report').scrollIntoView({ behavior: 'smooth' });
    $('codeBtn').onclick = sendCode;
    $('unlockBtn').onclick = unlockFull;
  }

  /* ===== 手机号验证码（纯前端演示） ===== */
  function sendCode() {
    const phone = $('contactPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { $('gateErr').textContent = '请输入正确的 11 位手机号'; return; }
    _code = String(Math.floor(100000 + Math.random() * 900000));
    $('codeHint').textContent = '演示验证码已生成：' + _code + '（纯前端演示，实际投放需接入短信接口）';
    $('gateErr').textContent = '';
  }
  function unlockFull() {
    const name = $('contactName').value.trim();
    const phone = $('contactPhone').value.trim();
    if (!name) { $('gateErr').textContent = '请填写联系人'; return; }
    if (!/^1[3-9]\d{9}$/.test(phone)) { $('gateErr').textContent = '请输入正确的 11 位手机号'; return; }
    if (!_code) { $('gateErr').textContent = '请先点击「获取验证码」'; return; }
    if ($('codeInput').value.trim() !== _code) { $('gateErr').textContent = '验证码错误，请重新获取'; return; }
    renderFull(_model, _inp, { name, phone });
  }

  /* ===== 第二步：完整方案 ===== */
  function renderFull(m, inp, contact) {
    const today = new Date().toLocaleDateString('zh-CN');
    const A = m.type === 'A';
    const cfDelta = m.newYearNetCF - m.oldYearNetCF;

    let summary;
    if (A) {
      summary = `在结清高息旧债的同时，额外多融约 <b>${f2(m.extra)} 万元</b>，其中净余约 <b>${f2(m.surplus)} 万元</b>可直接投建新电站；每年可支配现金流增加约 <b>${f2(cfDelta)} 万元</b>（置换后年净现金流 ${f2(m.newYearNetCF)} 万元），综合融资成本由 ${f2(m.oldAllInRate)}% 降至约 ${f2(m.newAllInRate)}%（全口径含服务费、管理费、运维费等，降幅约 ${f2(m.allInDrop * 100)}%）。`;
    } else {
      summary = `在结清高息旧债的同时，额外多融约 <b>${f2(m.extra)} 万元</b>，其中净余约 <b>${f2(m.surplus)} 万元</b>流动资金可直接投建新电站或补充运营；综合融资成本由 ${f2(m.oldAllInRate)}% 降至约 ${f2(m.newAllInRate)}%（全口径含服务费、管理费、运维费等，降幅约 ${f2(m.allInDrop * 100)}%），以可控服务费换取低息与资金放大。`;
    }

    const repayLabel = m.newRepay === 'quarter' ? '按季度还款' : '按月还款';
    const careRows = [
      ['可投新电站资金', '0 元', `约 ${f2(m.surplus)} 万`, `多融约 ${f2(m.extra)} 万，净余 ${f2(m.surplus)} 万可建新电站`],
      ['年度富余现金流', `${f2(m.oldYearNetCF)} 万`, `${f2(m.newYearNetCF)} 万`, `每年多出约 ${f2(cfDelta)} 万可支配现金`],
      ['综合融资成本（全口径）', `${f2(m.oldAllInRate)}%`, `约 ${f2(m.newAllInRate)}%`, `降幅约 ${f2(m.allInDrop * 100)}%（含利息/服务费/管理费/运维等）`],
      ['融资年限', `${m.oldYears} 年`, `${m.newYears} 年`, '期限明确、年还款压力降低'],
      ['还款方式', '原按月', repayLabel, '节奏更稳，与电费收取匹配'],
      ['全周期综合降本', '—', `约 ${f2(m.costSave)} 万`, '全周期累计少支出'],
      ['现金保证金占用', `${f2(m.oldDeposit)} 万`, `${f2(m.newDeposit)} 万（可用电站质押替代）`, '不占用运营资金']
    ];
    const careHTML = careRows.map(r => `<tr><td class="lbl">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('');

    const flowHTML = `<tr><td class="lbl">每期还款额</td><td>约 ${f2(m.oldMonth)} 万 / 月</td><td>约 ${f2(m.newQuarter)} 万 / ${m.newRepay === 'quarter' ? '季' : '月'}</td></tr>
      <tr><td class="lbl">每 3 个月累计还款</td><td>约 ${f2(m.old3m)} 万</td><td>约 ${f2(m.new3m)} 万</td></tr>
      <tr><td class="lbl">每 3 个月现金流出</td><td>基准</td><td>减少约 ${f2(m.flowDelta3m)} 万</td></tr>`;

    const feeHTML = `<tr><td class="lbl">服务费</td><td>融资额 ${f2($('svcRate').value)}%（约 ${f2(m.svc)} 万）</td><td>一次性，合同签订后收取</td></tr>
      <tr><td class="lbl">评估费</td><td>约 ${f2(m.evalF)} 万</td><td>评估公司收取（未过审收 0.6 万）</td></tr>
      <tr><td class="lbl">项目公司管理费</td><td>年电费×年限×${f2($('mgmtRate').value)}%（约 ${f2(m.mgmtTotal)} 万）</td><td>按年收取，每年初</td></tr>
      <tr><td class="lbl">运维费</td><td>装机×${f2($('opexRate').value)}万/MW/年（约 ${f2(m.opexTotal)} 万）</td><td>按年收取，每年初</td></tr>
      <tr><td class="lbl">融资保证金</td><td>约 ${f2(m.newDeposit)} 万（可退）</td><td>可以等价电站质押替代，免交现金</td></tr>`;

    const typeTag = A ? '真实降本型' : '资金放大型';

    const html = `
      <h1>光伏电站存量融资置换与并购贷综合服务方案</h1>
      <div class="sub">—— ${inp.projName || '（项目名称）'}</div>
      <div class="sub">致：${inp.custName || '（客户名称）'}　|　编制：光伏资产融资服务团队</div>
      <div class="sub">日期：${today}　|　方案版本：V1　|　保密 · 仅限双方项目对接使用</div>
      <div class="sub">对接联系人：${contact.name || '—'}　|　手机：${contact.phone || '—'}</div>

      <h2>客户收益速览 <span class="tag">${typeTag}</span></h2>
      <div class="kv">${summary}</div>

      <h2>一、能多融到多少钱，用在哪</h2>
      <ul>
        <li>放大融资：以「股权 + 债权」并购贷整体置换贵司约 ${f2(m.oldBalance)} 万元存量债务，新融资额度约 ${f2(m.newAmt)} 万元；</li>
        <li>资金用途：覆盖旧债后，多融约 ${f2(m.extra)} 万元——其中需先支付前期费用（不含保证金）约 ${f2(m.upfrontNoDeposit)} 万元，剩余净余约 ${f2(m.surplus)} 万元可专项投建新光伏电站（建成后质押给我司），也可用于支付我司响应费用；</li>
        <li>增信友好：置换后保证金约 ${f2(m.newDeposit)} 万元，可用等值已建成未融资电站质押替代，无需占压现金。</li>
      </ul>

      <h2>二、每年能多出来多少现金流</h2>
      <ul>
        <li>明显增厚：置换前年净现金流约 ${f2(m.oldYearNetCF)} 万元，置换后约 ${f2(m.newYearNetCF)} 万元；</li>
        <li>抗风险+可扩张：相当于每年多出约 ${f2(cfDelta)} 万元可支配现金，可用于抵充政策风险、应对电费回款不及时或天气波动，也可滚动投资新电站；</li>
        <li>节奏更稳：还款节奏改为${repayLabel}，平滑月度资金压力，与电费收取节奏更匹配。</li>
      </ul>
      <p>还款节奏对比（每 3 个月现金流出）：</p>
      <table><thead><tr><th>对比维度</th><th>原方案（按月还本付息）</th><th>置换后（${repayLabel}）</th></tr></thead><tbody>${flowHTML}</tbody></table>
      <p>即利率下降叠加${repayLabel}，贵司每 3 个月的现金流出较原结构明显减少，资金调度更从容。</p>

      <h2>三、综合融资成本降多少</h2>
      <ul>
        <li>利率直降：银行利率由 ${f2(m.oldRate)}% 降至 ${f2(m.newRate)}%；</li>
        <li>全口径成本：综合融资成本（含利息、服务费、评估费、管理费、运维费）由约 ${f2(m.oldAllInRate)}% 降至约 ${f2(m.newAllInRate)}%，实际降幅约 ${f2(m.allInDrop * 100)}%；</li>
        <li>每年更轻：置换后每年本息及综合支出约 ${f2(m.newYearActual)} 万元（含管理、运维全口径）；</li>
        ${A ? `<li>全周期省：全周期（${m.newYears} 年）综合成本支出较原结构累计减少约 ${f2(m.costSave)} 万元（含利息、服务费、管理费、运维费等），是实实在在的长期成本节约。</li>` : `<li>全周期账：以可控服务费换取低息与资金放大，综合融资成本结构更优，现金流更从容。</li>`}
      </ul>

      <h2>四、做这笔置换，对您公司的意义</h2>
      <ul>
        <li>盘活存量：结清高息旧债、释放被压住的股权与现金流，电站从"负债包袱"变回"生息资产"；</li>
        <li>用别人的钱扩张：多融资金可直接投建新电站，用低成本外部资金放大自有资产规模，滚动开发不依赖自有资金；</li>
        <li>轻装运营：融资成本大幅下降，每年多出可观净现金流，抗政策与天气风险能力增强；</li>
        <li>不伤主业：通过承债式收购平稳过渡股权，不影响电站正常发电与电费收取；</li>
        <li>不占现金：以电站质押替代保证金，前期几乎不占用贵司运营资金。</li>
      </ul>

      <h2>五、方案如何落地</h2>
      <p>操作路径（股权 + 债权承债式收购）：</p>
      <ul>
        <li>我方融资机构先还清贵司旧债，释放对应电站股权；</li>
        <li>完成股权变更与质押登记，搭建新融资架构（额度高于常规项目贷，更适配存量整合）；</li>
        <li>按${repayLabel}还本付息，新放款覆盖旧债并完成多融资金投放。</li>
      </ul>
      <p>实施时间表：</p>
      <table><thead><tr><th>阶段</th><th>工作内容</th><th>周期</th></tr></thead><tbody>
        <tr><td class="lbl">前期准备</td><td>收集并核对项目资料、存量融资合同</td><td>约 15–20 天</td></tr>
        <tr><td class="lbl">银行审批</td><td>项目报融资机构审批</td><td>约 2 个月</td></tr>
        <tr><td class="lbl">置换落地</td><td>还清旧债、股权变更与质押、新放款</td><td>审批通过后按协议执行</td></tr>
      </tbody></table>
      <p>服务费用一览（签订后收取，透明可核）：</p>
      <table><thead><tr><th>费用项</th><th>标准</th><th>说明</th></tr></thead><tbody>${feeHTML}</tbody></table>

      <h2>六、我们的合作方式</h2>
      <ul>
        <li>试点先行：先以本项目报银行审批，验证方案与审批口径；</li>
        <li>跑通后再打包贵司其余存量电站批量置换，规模效应更优；</li>
        <li>资料可分期提供，无需一次性齐备，最大限度降低贵司整理负担。</li>
      </ul>
      <p style="font-size:12px;color:#6b7a82">以上数据均基于贵司项目融资对比分析测算，最终以正式协议为准。</p>

      <div class="cta">
        <h3>想拿专属方案细节？添加顾问微信一对一沟通</h3>
        <p>把您的电站融资信息发我，免费帮您做一份置换测算</p>
        ${WECHAT.id ? '<div class="wx">微信号：' + WECHAT.id + '</div><p>（长按复制添加，备注"光伏融资"优先通过）</p>' : ''}
        <img src="${WECHAT.qr}" alt="微信二维码" onerror="this.style.display='none'">
        <p class="wxtip">扫码或添加顾问微信，获取一对一融资置换诊断。</p>
      </div>
    `;
    $('doc').innerHTML = html;
    $('report').style.display = 'block';
    $('report').scrollIntoView({ behavior: 'smooth' });
    if (window.print) {
      const btn = document.createElement('button');
      btn.className = 'btn no-print';
      btn.textContent = '打印 / 保存为 PDF';
      btn.style.margin = '14px 0';
      btn.onclick = () => window.print();
      $('doc').parentNode.insertBefore(btn, $('doc'));
    }
  }

  function fillExample() {
    const ex = {
      custName: '智晨', projName: '昂利泰—奥美森 4.416MW', oldOrg: '创佳',
      oldMw: 4.416, oldAmt: 915, oldBalance: 825, oldRate: 8, oldRepay: 'emi',
      oldYears: 10, oldAnnual: 167.808, oldDeposit: 41.25, oldPenalty: 0,
      newAmt: 970, newYears: 10, newRepay: 'month',
      newRate: 4, svcRate: 5, evalFee: 2, mgmtRate: 2.5, opexRate: 1, newDeposit: 121.25, newPenalty: 0
    };
    for (const k in ex) { const el = $(k); if (el) el.value = ex[k]; }
    generate();
  }

  function reset() {
    // 清空所有输入；select 复位首项
    ['custName', 'projName', 'oldOrg', 'oldMw', 'oldAmt', 'oldBalance', 'oldRate',
      'oldYears', 'oldAnnual', 'oldDeposit', 'oldPenalty', 'newAmt', 'newYears',
      'newRate', 'svcRate', 'evalFee', 'mgmtRate', 'opexRate', 'newDeposit', 'newPenalty',
      'contactName', 'contactPhone', 'codeInput'].forEach(k => {
      const el = $(k); if (!el) return;
      if (el.tagName === 'SELECT') el.selectedIndex = 0; else el.value = '';
    });
    // 恢复新方案标准默认值（④ 区块）
    const def = { newRate: 4, svcRate: 5, evalFee: 2, mgmtRate: 2.5, opexRate: 1, newPenalty: 0 };
    for (const k in def) { const el = $(k); if (el) el.value = def[k]; }
    $('err').textContent = '';
    if ($('gateErr')) $('gateErr').textContent = '';
    if ($('codeHint')) $('codeHint').textContent = '';
    _code = ''; _model = null; _inp = null;
    $('report').style.display = 'none';
  }

  window.addEventListener('DOMContentLoaded', function () {
    $('genBtn').onclick = generate;
    $('exBtn').onclick = fillExample;
    $('resetBtn').onclick = reset;
  });
})();
