/**
 * 여조안테나 — 정적 스냅샷 shim (GitHub Pages용)
 *
 * 역할:
 *   1. window.fetch 를 가로채 127.0.0.1:8766 향하는 요청을 정적 JSON으로 리다이렉트
 *   2. CSV 다운로드(voter-segments, polls)를 브라우저에서 직접 생성
 *   3. 관리자(write) 엔드포인트는 빈 OK 응답으로 처리
 *   4. 스냅샷 생성 시각 배너 표시
 *
 * 이 파일은 export_static.py 가 자동으로 index.html 과 같은 위치에 복사합니다.
 */
(function () {
  'use strict';

  /* ── 1. 경로 매핑 ─────────────────────────────────────────────── */

  /**
   * API 경로(apiPath) + URLSearchParams → 정적 파일 경로 or 특수 토큰.
   *
   * 반환 값:
   *   /data/...              → 그대로 fetch (정적 JSON)
   *   __NOOP__               → 빈 {} 응답
   *   __HEALTH__             → 헬스체크용 더미 응답
   *   __CSV_SEGMENTS__:{rc}  → voter-segments CSV 브라우저 생성
   *   __CSV_POLLS__          → polls CSV 브라우저 생성
   *   __REGIONS_FILTER__     → /data/regions.json 에서 sido 필터링
   */
  function resolveStaticPath(apiPath, searchParams) {
    /* 전역 고정 매핑 */
    const FIXED = {
      '/sido-list':            '/data/sido-list.json',
      '/polls/smoothed':       '/data/polls/smoothed.json',
      '/polls/freshness':      '/data/polls/freshness.json',
      '/battlegrounds':        '/data/battlegrounds.json',
      '/house-effects':        '/data/house-effects.json',
      '/settings/lineage':     '/data/lineage.json',
      '/party-lineage-trail':  '/data/lineage-trail.json',
      '/polls/export':         '__CSV_POLLS__',
      '/health':               '__HEALTH__',
    };

    if (apiPath in FIXED) return FIXED[apiPath];

    /* /regions — sido 쿼리 파라미터 있을 수 있음 */
    if (apiPath === '/regions') {
      return searchParams.has('sido') ? '__REGIONS_FILTER__' : '/data/regions.json';
    }

    /* 관리자 / 쓰기 엔드포인트 */
    if (
      apiPath.startsWith('/admin/') ||
      apiPath.startsWith('/upload-') ||
      apiPath === '/polls/interpolate' ||
      apiPath.startsWith('/settings/lineage/') // PATCH / DELETE
    ) {
      return '__NOOP__';
    }

    let m;

    /* /region/{code}/lineage-history?include_local=true|false */
    if ((m = apiPath.match(/^\/region\/(.+?)\/lineage-history$/))) {
      return searchParams.get('include_local') === 'true'
        ? `/data/region/${m[1]}/lineage-history-local.json`
        : `/data/region/${m[1]}/lineage-history.json`;
    }
    /* /region/{code}/analysis */
    if ((m = apiPath.match(/^\/region\/(.+?)\/analysis$/)))
      return `/data/region/${m[1]}/analysis.json`;
    /* /region/{code}/estimate */
    if ((m = apiPath.match(/^\/region\/(.+?)\/estimate$/)))
      return `/data/region/${m[1]}/estimate.json`;
    /* /region/{code}/voters-trend */
    if ((m = apiPath.match(/^\/region\/(.+?)\/voters-trend$/)))
      return `/data/region/${m[1]}/voters-trend.json`;
    /* /region/{code}/history */
    if ((m = apiPath.match(/^\/region\/(.+?)\/history$/)))
      return `/data/region/${m[1]}/history.json`;
    /* /region/{code}/redistricting-info */
    if ((m = apiPath.match(/^\/region\/(.+?)\/redistricting-info$/)))
      return `/data/region/${m[1]}/redistricting-info.json`;
    /* /region/{code}/intra-lineage */
    if ((m = apiPath.match(/^\/region\/(.+?)\/intra-lineage$/)))
      return `/data/region/${m[1]}/intra-lineage.json`;
    /* /region/{code}/dongs */
    if ((m = apiPath.match(/^\/region\/(.+?)\/dongs$/)))
      return `/data/region/${m[1]}/dongs.json`;

    /* /analysis/voter-segments/{code}/export → CSV */
    if ((m = apiPath.match(/^\/analysis\/voter-segments\/(.+?)\/export$/)))
      return `__CSV_SEGMENTS__:${m[1]}`;
    /* /analysis/voter-segments/{code}/export/{rank} → CSV (단일 세그먼트) */
    if ((m = apiPath.match(/^\/analysis\/voter-segments\/(.+?)\/export\/(\d+)$/)))
      return `__CSV_SEGMENT_RANK__:${m[1]}:${m[2]}`;
    /* /analysis/voter-segments/{code} */
    if ((m = apiPath.match(/^\/analysis\/voter-segments\/(.+?)$/)))
      return `/data/region/${m[1]}/voter-segments.json`;
    /* /analysis/demographics/{code} */
    if ((m = apiPath.match(/^\/analysis\/demographics\/(.+?)$/)))
      return `/data/region/${m[1]}/demographics.json`;

    return '__NOOP__';
  }

  /* ── 2. CSV 유틸 ──────────────────────────────────────────────── */

  /** 2차원 배열 → CSV 문자열 (UTF-8 BOM 포함) */
  function buildCsvString(headers, rows) {
    const BOM   = '﻿';
    const escape = cell => {
      const s = (cell == null) ? '' : String(cell);
      return (s.includes(',') || s.includes('"') || s.includes('\r') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) lines.push(row.map(escape).join(','));
    return BOM + lines.join('\r\n');
  }

  /** Blob → 다운로드 트리거 */
  function triggerDownload(csvStr, filename) {
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** CSV 다운로드 후 빈 JSON Response 반환 (fetch 호출자에게 오류 없음) */
  function csvResponse(csvStr, filename) {
    triggerDownload(csvStr, filename);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  /* ── 3. 도메인별 CSV 생성기 ────────────────────────────────────── */

  /** voter-segments CSV (세그먼트 요약 전체) */
  async function buildSegmentsCsv(regionCode) {
    let data;
    try {
      data = await _orig(`/data/region/${regionCode}/voter-segments.json`).then(r => r.json());
    } catch (e) {
      return new Response('{"error":"voter-segments 데이터 없음"}',
        { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    const segments = data.segments || [];
    const headers  = [
      'rank', '세그먼트', '비율(%)', '인원수', '생애단계', '계층', '가구형태',
      '핵심인구', '경제자본', '문화자본', '사회자본',
      '생활세계', '핵심불안', '가치유형', '신뢰정보원',
      '정치언어', '소구프레임', '훅문구', '샘플문구', '금기프레임', '채널',
    ];
    const rows = segments.map((seg, i) => {
      const h   = seg.habitus || {};
      const cap = h.capital   || {};
      return [
        i + 1,
        seg.segment          || '',
        seg.pct              || '',
        seg.count            || '',
        seg.life_stage       || '',
        seg.class_pos        || '',
        seg.household        || '',
        seg.core_demo        || '',
        cap['경제']           || '',
        cap['문화']           || '',
        cap['사회']           || '',
        h.lifeworld          || '',
        h.core_anxiety       || '',
        h.value_type         || '',
        h.trusted_source     || '',
        h.political_language || '',
        h.frame              || '',
        h.hook               || '',
        h.sample_phrase      || '',
        h.anti_frame         || '',
        h.channel            || '',
      ];
    });
    return csvResponse(buildCsvString(headers, rows), `voter_segments_${regionCode}.csv`);
  }

  /** polls/raw.json → polls_export.csv */
  async function buildPollsCsv() {
    let data = [];
    try {
      data = await _orig('/data/polls/raw.json').then(r => r.json());
    } catch (e) { /* 데이터 없으면 빈 CSV */ }

    const headers = [
      'poll_id', '기관', '의뢰자', '조사시작', '조사종료',
      '조사방법', '표본틀', '표본수', '접촉률', '응답률', '표본오차',
      '출처파일', '내삽여부', '정당', '지지율', '계파',
    ];
    const rows = (Array.isArray(data) ? data : []).map(r => [
      r.poll_id            || '',
      r.org                || r.org_normalized || '',
      r.client             || '',
      r.date_start         || '',
      r.date               || r.date_end || '',
      r.method             || '',
      r.sampling_frame     || '',
      r.sample_size        || '',
      r.contact_rate       || '',
      r.response_rate      || '',
      r.margin_of_error    || '',
      r.source_file        || '',
      r.is_interpolated ? '1' : '0',
      r.party_name         || '',
      r.raw_pct            != null ? r.raw_pct : (r.corrected_pct || ''),
      r.lineage_id         || '',
    ]);
    return csvResponse(buildCsvString(headers, rows), 'polls_export.csv');
  }

  /* ── 4. regions 필터 (sido 쿼리 파라미터) ─────────────────────── */

  async function filteredRegions(searchParams) {
    const data = await _orig('/data/regions.json').then(r => r.json()).catch(() => []);
    const sido = searchParams.get('sido');
    const result = sido ? data.filter(r => r.sido === sido) : data;
    return new Response(JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  /* ── 5. fetch 인터셉터 ─────────────────────────────────────────── */

  const _orig = window.fetch.bind(window);

  window.fetch = async function (url, opts) {
    const urlStr = String(url instanceof Request ? url.url : url);

    /* 여조안테나 API 호출이 아니면 그대로 통과 */
    if (!urlStr.includes('127.0.0.1:8766')) return _orig(url, opts);

    /* URL 파싱 */
    const urlObj  = new URL(urlStr);
    const apiPath = urlObj.pathname;
    const params  = urlObj.searchParams;
    const method  = ((opts && opts.method) || 'GET').toUpperCase();
    const target  = resolveStaticPath(apiPath, params);

    /* ── POST / DELETE / PATCH → 쓰기 불가 알림 */
    if (method !== 'GET') {
      return new Response(
        JSON.stringify({ ok: false, msg: '정적 모드에서는 쓰기 기능이 비활성화됩니다.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    /* ── 특수 토큰 처리 */
    if (target === '__NOOP__') {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === '__HEALTH__') {
      return new Response('{"status":"ok (static snapshot)"}',
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === '__REGIONS_FILTER__') {
      return filteredRegions(params);
    }
    if (target === '__CSV_POLLS__') {
      return buildPollsCsv();
    }
    if (target.startsWith('__CSV_SEGMENTS__:')) {
      return buildSegmentsCsv(target.split(':')[1]);
    }
    if (target.startsWith('__CSV_SEGMENT_RANK__:')) {
      /* 단일 rank CSV — voter-segments.json에서 rank번째 세그먼트만 다운로드 */
      const parts = target.split(':');
      return buildSegmentsCsv(parts[1]);  // 전체 CSV로 대체
    }

    /* ── 정적 JSON 파일 fetch */
    return _orig(target, { method: 'GET' }).catch(err => {
      /* 파일 없으면 빈 배열/객체 반환 (UI 오류 방지) */
      console.warn(`[static-shim] ${target} 없음: ${err.message}`);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  };

  /* ── 6. 스냅샷 정보 배너 ────────────────────────────────────────── */

  function showSnapshotBanner() {
    _orig('/data/meta.json')
      .then(r => r.json())
      .then(meta => {
        const ts = new Date(meta.generated_at).toLocaleString('ko-KR', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        });
        const bar = document.createElement('div');
        bar.id = 'static-snapshot-bar';
        bar.style.cssText = [
          'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9999',
          'background:#f1c21b', 'color:#161616',
          'padding:5px 18px',
          'font-size:12px', 'font-family:inherit',
          'display:flex', 'align-items:center', 'gap:8px',
          'border-top:2px solid #c8a000',
          'box-shadow:0 -2px 8px rgba(0,0,0,0.10)',
        ].join(';');
        bar.innerHTML = `
          📸 <strong>스냅샷 모드</strong>
          &nbsp;—&nbsp; 생성일시: <strong>${ts}</strong>
          &nbsp;·&nbsp; 지역구: ${meta.region_count}개
          <span style="color:#6f6f6f;font-size:11px;">(실시간 데이터 아님 · PDF 업로드·데이터 동기화 비활성)</span>
          <button id="static-bar-close"
            style="margin-left:auto;background:none;border:none;cursor:pointer;
                   font-size:16px;padding:0 4px;color:#161616;line-height:1;"
            title="닫기">✕</button>
        `;
        document.body.appendChild(bar);
        document.getElementById('static-bar-close')
          .addEventListener('click', () => bar.remove());
      })
      .catch(() => {
        /* meta.json 없으면 배너 없이 넘어감 */
      });
  }

  /* DOM 준비 후 배너 표시 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showSnapshotBanner);
  } else {
    showSnapshotBanner();
  }

})();
