// 플래시카드 덱. 지금은 샘플만 들어 있습니다.
// 카드 형식: { id, front, back } — id는 진도 기록의 키라서 한 번 정하면 바꾸지 마세요.
// 안경 화면이 작으니 front는 한 줄, back은 두세 줄 안쪽으로 짧게 쓰는 게 좋습니다.

export const DECKS = [
  {
    id: 'vocab',
    name: '영단어',
    cards: [
      { id: 'v-abandon', front: 'abandon', back: '버리다, 포기하다\nabandon a plan' },
      { id: 'v-acquire', front: 'acquire', back: '얻다, 습득하다\nacquire a skill' },
      { id: 'v-adequate', front: 'adequate', back: '충분한, 적절한' },
      { id: 'v-allocate', front: 'allocate', back: '할당하다, 배분하다' },
      { id: 'v-comprehensive', front: 'comprehensive', back: '포괄적인, 종합적인' },
      { id: 'v-consistent', front: 'consistent', back: '일관된, 한결같은' },
      { id: 'v-deteriorate', front: 'deteriorate', back: '악화되다' },
      { id: 'v-eliminate', front: 'eliminate', back: '제거하다, 없애다' },
      { id: 'v-feasible', front: 'feasible', back: '실현 가능한' },
      { id: 'v-implement', front: 'implement', back: '시행하다, 구현하다' },
    ],
  },
  {
    id: 'sqld',
    name: 'SQLD',
    cards: [
      { id: 's-1nf', front: '제1정규형(1NF)', back: '모든 속성이 원자값\n(반복 그룹 제거)' },
      { id: 's-2nf', front: '제2정규형(2NF)', back: '부분 함수 종속 제거\n(기본키 일부에만 종속된 속성 분리)' },
      { id: 's-3nf', front: '제3정규형(3NF)', back: '이행 함수 종속 제거\n(A->B->C 에서 C 분리)' },
      { id: 's-bcnf', front: 'BCNF', back: '모든 결정자가 후보키' },
      { id: 's-ddl', front: 'DDL 종류', back: 'CREATE ALTER DROP\nRENAME TRUNCATE' },
      { id: 's-dml', front: 'DML 종류', back: 'SELECT INSERT\nUPDATE DELETE' },
      { id: 's-dcl-tcl', front: 'DCL / TCL', back: 'DCL: GRANT REVOKE\nTCL: COMMIT ROLLBACK SAVEPOINT' },
      { id: 's-order', front: 'SELECT 실행 순서', back: 'FROM WHERE GROUP BY\nHAVING SELECT ORDER BY' },
      { id: 's-count', front: 'COUNT(*) vs COUNT(col)', back: 'COUNT(*): NULL 포함 행 수\nCOUNT(col): NULL 제외' },
      { id: 's-nvl', front: 'NVL / NULLIF / COALESCE', back: 'NVL(a,b): a가 NULL이면 b\nNULLIF(a,b): 같으면 NULL\nCOALESCE: 첫 non-NULL' },
      { id: 's-rank', front: 'RANK / DENSE_RANK / ROW_NUMBER', back: '1,1,3 / 1,1,2 / 1,2,3' },
      { id: 's-rollup', front: 'ROLLUP vs CUBE', back: 'ROLLUP: 계층별 소계(순서 중요)\nCUBE: 모든 조합 소계' },
    ],
  },
]
