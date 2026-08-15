from services.external_data.selected_documents import merge_external_context_documents


def test_directly_selected_document_wins_over_service_search_duplicate() -> None:
    selected = [{
        "id": "doc-1",
        "external_resource_id": "kr.gov24",
        "content": "full document",
        "direct_document": True,
    }]
    searched = [{
        "id": "doc-1",
        "external_resource_id": "kr.gov24",
        "content": "search excerpt",
    }]

    merged = merge_external_context_documents(selected, searched)

    assert merged == selected


def test_same_document_id_from_different_services_is_preserved() -> None:
    documents = [
        {"id": "shared-id", "external_resource_id": "kr.gov24", "content": "gov24"},
        {"id": "shared-id", "external_resource_id": "kr.housing", "content": "housing"},
    ]

    assert merge_external_context_documents([], documents) == documents
