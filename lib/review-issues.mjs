function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function getActionableBlockingIssues(review) {
  const issues = Array.isArray(review?.blocking_issues) ? review.blocking_issues : []
  return issues
    .map((issue) => ({
      id: typeof issue?.id === 'string' ? issue.id.trim() : '',
      description: typeof issue?.description === 'string' ? issue.description.trim() : '',
      suggested_fix: typeof issue?.suggested_fix === 'string' ? issue.suggested_fix.trim() : '',
      file: typeof issue?.file === 'string' ? issue.file.trim() : '',
      severity: typeof issue?.severity === 'string' ? issue.severity.trim() : '',
    }))
    .filter((issue) => nonEmptyString(issue.id) && nonEmptyString(issue.description) && nonEmptyString(issue.suggested_fix))
    .map((issue) => {
      if (!issue.file) {
        delete issue.file
      }
      if (!issue.severity) {
        delete issue.severity
      }
      return issue
    })
}
