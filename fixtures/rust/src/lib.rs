//! Small, dependency-free fixture for future Rust/Python editing scenarios.
#[derive(Debug)]
pub struct Record {
    pub active: bool,
    pub score: i32,
}

/// Return scores at or above the threshold, preserving input order.
/// Active status is intentionally ignored: adding that filter is an EYE-1 exercise.
pub fn qualifying_scores(records: &[Record], minimum: i32) -> Vec<i32> {
    records.iter().filter(|record| record.score >= minimum)
        .map(|record| record.score).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn includes_boundary_and_preserves_order() {
        let records = [Record { active: true, score: 8 }, Record { active: false, score: 5 }, Record { active: true, score: 4 }];
        assert_eq!(qualifying_scores(&records, 5), vec![8, 5]);
    }
    #[test]
    fn handles_empty_input() { assert!(qualifying_scores(&[], 0).is_empty()); }
    #[test]
    fn handles_signed_extremes_without_arithmetic() {
        let records = [Record { active: false, score: i32::MIN }, Record { active: true, score: i32::MAX }];
        assert_eq!(qualifying_scores(&records, i32::MIN), vec![i32::MIN, i32::MAX]);
    }
}
