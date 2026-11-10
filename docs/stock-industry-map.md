# 미국 섹터·산업 지도

미국 S&P 500 지도는 **시총 비중과 화면 면적에 따라 산업을 분리**한다. 산업의 시총 비중이 지도 전체의 1% 이상이고 예상 면적이 16,000px² 이상일 때 독립 그룹으로 표시한다. 작은 산업은 원래 섹터명으로 합쳐 시가총액 상위 15종목만 표시한다. 독립 산업이 없는 섹터도 섹터 단위로 상위 15종목을 표시한다. 화면이 좁아지면 산업 구분이 줄어들고, 섹터를 확대하면 더 세분화된다. 타일 크기는 표시 종목의 시가총액 비례를 유지한다.

- 구성 종목과 상위 섹터: iShares IVV 보유종목 CSV.
- 세부산업: `datasets/s-and-p-500-companies`의 `constituents.csv`에서 `GICS Sub-Industry`를 티커로 매칭한다. 이 데이터셋은 Wikipedia의 S&P 500 구성 자료를 바탕으로 한다. Finviz 산업 명칭과 동일한 분류가 아니다.
- 데이터셋: https://github.com/datasets/s-and-p-500-companies
- 섹터·세부산업·포함 종목을 하나의 구성 스냅샷으로 묶어 앱 설치 데이터 폴더의 `cache/stock-analysis-us-groups.json`에 원자적으로 저장한다. 미국 동부 날짜 기준 하루에 한 번, 첫 조회 시 갱신한다. 같은 날에는 앱을 재시작해도 저장된 구성을 사용한다. 갱신 실패·불완전 응답은 전체 이전 스냅샷을 유지하고 15분 후 재시도한다.
- 가격·등락률·시가총액은 구성 데이터와 분리해 기존 시세 주기로 갱신한다. 구성 데이터의 조회 주기는 화면 크기에 따른 그룹 분할과 무관하다.
- 미국 지도는 독립 산업에는 시가총액이 있는 구성 종목을 표시하고, 작은 산업을 모은 섹터 그룹에는 시가총액 상위 15종목을 표시한다. 한국·일본 지도와 사용자 그룹의 기존 제한은 유지한다.
- 분류가 없는 종목은 다른 분류와 함께 있을 때 ‘미분류’에 포함한다. 한 섹터의 분류를 전혀 얻지 못하면 기존의 섹터 → 종목 배치로 표시한다.
- 산업 제목이나 해당 산업의 종목에 마우스를 올리면 해당 산업의 종목 목록을 표시한다. 산업 제목을 클릭하면 소속 섹터를 확대한다.
- 지도 로딩 시 각 표시 그룹의 상위 15종목 미니 그래프를 백그라운드로 미리 조회한다. 팝업 선택 종목이 미리 받은 범위 밖에 있으면 우선순위를 높여 조회한다. 동시 배치는 2개, 배치당 20종목으로 제한하고 중복 요청을 공유한다.
- 최근 20개 유효 가격을 거래일별로 캐시하고 최근 2개 날짜의 데이터를 브라우저 저장소에도 보존한다. 조회 중이거나 가격 데이터가 부족한 미니 그래프는 기호나 로딩 배경 없이 빈칸으로 표시한다. 차트 칸의 크기는 유지한다.
- 가격 칸의 너비를 고정하고 미니 그래프를 칸 너비에 맞춰 그려 행별 오른쪽 끝점이 달라지지 않게 한다.

구성 캐시는 `app/services/stock_analysis/market_group_cache.py`, 분류 파서는 `app/services/stock_analysis/industry_classification.py`, 계층 구성은 `frontend/src/components/StockAnalysis/sectorMapLayout.ts`에 있다. 사용자 지정 섹터맵 API는 종목별 선택 필드 `industry`를 제공하면 같은 방식으로 표시된다.

팝업은 최대 15종목 중 실제 표시하는 행 수에 맞춰 높이를 정한다. 전체 높이는 지도 영역 내로 제한하며, 마우스 오른쪽에 여유가 있으면 오른쪽에, 부족하면 왼쪽에 80px 간격을 두고 표시한다. 좌우 전환은 즉시 적용해 팝업이 커서를 가로질러 이동하지 않게 하며, 세로 위치는 마우스 높이에 맞추고 아래 공간이 부족하면 위로 조정한다. 팝업 크기가 바뀌어도 지도 경계를 벗어나지 않으며 좁은 지도에서는 지도 안쪽 여백에 맞춰 제한한다. 마우스 이동은 팝업의 CSS 위치만 갱신하므로 전체 타일을 매번 다시 렌더링하지 않는다.

US layout weights are persisted once per New York calendar day alongside membership. Intraday refreshes update prices and percentage changes without changing tile weights. Missing market caps retain the previous daily weight; restarting the app preserves the daily layout.
