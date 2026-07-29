FROM docker.elastic.co/elasticsearch/elasticsearch:9.4.2

# 다국어 RAG 분석기: 한국어, 일본어, 중국어 및 ICU Unicode 정규화
RUN bin/elasticsearch-plugin install --batch analysis-nori analysis-kuromoji analysis-smartcn analysis-icu
