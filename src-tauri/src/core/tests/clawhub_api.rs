use super::*;

#[test]
fn search_response_deserializes() {
    let json = r#"{
        "results": [
            {
                "score": 3.04,
                "slug": "finviz-crawler",
                "displayName": "finviz-crawler",
                "summary": "Continuous financial news crawler.",
                "version": "2.0.0",
                "updatedAt": 1771746936907
            },
            {
                "score": 1.5,
                "slug": null,
                "displayName": null,
                "summary": null,
                "version": null,
                "updatedAt": null
            }
        ]
    }"#;

    let resp: SearchResponse = serde_json::from_str(json).unwrap();
    assert_eq!(resp.results.len(), 2);
    assert_eq!(resp.results[0].slug.as_deref(), Some("finviz-crawler"));
    assert!((resp.results[0].score - 3.04).abs() < 0.001);
}

#[test]
fn get_skill_response_deserializes() {
    let json = r#"{
        "skill": {
            "slug": "gifgrep",
            "displayName": "GifGrep",
            "summary": "Search gifs",
            "tags": {},
            "stats": {},
            "createdAt": 1000,
            "updatedAt": 2000
        },
        "latestVersion": {
            "version": "1.2.3",
            "createdAt": 3000,
            "changelog": "Initial release"
        },
        "owner": {
            "handle": "steipete",
            "displayName": "Peter",
            "image": null
        }
    }"#;

    let resp: GetSkillResponse = serde_json::from_str(json).unwrap();
    let skill = resp.skill.unwrap();
    assert_eq!(skill.slug, "gifgrep");
    assert_eq!(skill.display_name, "GifGrep");
    assert_eq!(resp.latest_version.unwrap().version, "1.2.3");
    assert_eq!(resp.owner.unwrap().handle.as_deref(), Some("steipete"));
}

#[test]
fn search_filters_out_null_slugs() {
    // Simulated: if API returns entries with null slugs they should be filtered
    let items = vec![
        SearchResultItem {
            score: 3.0,
            slug: Some("valid".to_string()),
            display_name: Some("Valid".to_string()),
            summary: None,
            version: None,
            updated_at: None,
        },
        SearchResultItem {
            score: 1.0,
            slug: None,
            display_name: None,
            summary: None,
            version: None,
            updated_at: None,
        },
    ];

    let results: Vec<ClawHubSkill> = items
        .into_iter()
        .filter_map(|item| {
            Some(ClawHubSkill {
                slug: item.slug?,
                display_name: item.display_name.unwrap_or_default(),
                summary: item.summary,
                version: item.version,
                score: item.score,
                updated_at: item.updated_at,
            })
        })
        .collect();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].slug, "valid");
}
