// 백준(acmicpc.net) 화면에 의존하는 부분을 모아 둔 곳.
// 백준이 화면 구조를 바꾸면 여기만 고치면 되도록, 선택자와 읽는 함수를 한곳에 둔다.
// 제출 양식의 두 world는 shared/submit-selectors.js를 함께 사용한다.

globalThis.CBOJ_SEL = Object.freeze({
  // 문제 페이지 (/problem/번호)
  problem: Object.freeze({
    titleButtons: '.problem-button',          // 제목 옆 버튼 묶음 ([⇆ 코드 작성]을 넣는 곳)
    specialJudge: '.problem-label-spj',       // '스페셜 저지' 라벨
    sampleInput: 'pre[id^="sample-input-"]',  // 예제 입력
    sampleInputPrefix: 'sample-input-',
    sampleOutputPrefix: 'sample-output-',     // 예제 출력 (id = sample-output-번호)
    username: 'meta[name="username"]',        // 로그인한 아이디
  }),
  // 채점 현황 (/status)
  status: Object.freeze({
    rows: '#status-table tbody tr',
    rowIdPrefix: 'solution-',
    result: '.result-text',
    memory: 'td.memory',
    time: 'td.time',
    platform: 'td.judge-platform',
  }),
});

globalThis.cbojBoj = Object.freeze({
  username() {
    const el = document.querySelector(globalThis.CBOJ_SEL.problem.username);
    return (el && el.content) || '';
  },
  isSpecialJudge() {
    return !!document.querySelector(globalThis.CBOJ_SEL.problem.specialJudge);
  },
  titleButtons() {
    return document.querySelector(globalThis.CBOJ_SEL.problem.titleButtons);
  },
  // 문제의 예제 목록 [{ n, input, expected }]
  samples() {
    const S = globalThis.CBOJ_SEL.problem;
    return [...document.querySelectorAll(S.sampleInput)].map((pre) => {
      const n = pre.id.slice(S.sampleInputPrefix.length);
      const out = document.getElementById(S.sampleOutputPrefix + n);
      return { n, input: pre.textContent, expected: out ? out.textContent : null };
    });
  },
});

// 채점 결과 분류
globalThis.CBOJ_FINAL = Object.freeze(['ac', 'pac', 'wa', 'pe', 'tle', 'mle', 'ole', 'rte', 'ce']);

globalThis.cbojResultKey = (span, text) => {
  const FINAL = globalThis.CBOJ_FINAL;
  if (span) {
    for (const c of span.classList) {
      const m = /^result-(.+)$/.exec(c);
      if (m && m[1] !== 'text' && FINAL.includes(m[1])) return m[1];
    }
  }
  const rules = [
    [/맞았습니다/, 'ac'], [/출력 형식/, 'pe'], [/틀렸습니다/, 'wa'], [/시간 초과/, 'tle'],
    [/메모리 초과/, 'mle'], [/출력 초과/, 'ole'], [/런타임 에러/, 'rte'], [/컴파일 에러/, 'ce'],
    [/^\s*\d+(\.\d+)?\s*점/, 'pac'],
  ];
  for (const [re, k] of rules) if (re.test(text || '')) return k;
  return 'pending';
};

// 채점 현황 표의 한 줄:
// 제출 번호 | 아이디 | 문제 | 결과 | 메모리 | 시간 | (채점 서버) | 언어 | 코드 길이 | 제출한 시간
globalThis.cbojParseRow = (tr) => {
  const S = globalThis.CBOJ_SEL.status;
  const td = [...tr.querySelectorAll('td')];
  const span = tr.querySelector(S.result);
  const txt = (el) => ((el || {}).textContent || '').trim();
  const text = (span ? span.textContent : txt(td[3])).trim();
  const langIdx = tr.querySelector(S.platform) || td.length >= 10 ? 7 : 6;
  const mem = txt(tr.querySelector(S.memory) || td[4]);
  const time = txt(tr.querySelector(S.time) || td[5]);
  return {
    id: txt(td[0]),
    text,
    key: globalThis.cbojResultKey(span, text),
    memory: mem ? (/^\d+$/.test(mem) ? mem + ' KB' : mem) : '',
    time: time ? (/^\d+$/.test(time) ? time + ' ms' : time) : '',
    lang: txt(td[langIdx]).replace(/\s*\/\s*수정$/, ''),
  };
};
