// Machine-readable bridge for the plain-language test report.
export default async function* report(source) {
  for await (const { type, data } of source) {
    if (type === 'test:pass' || type === 'test:fail') {
      const error = data.details?.error;
      yield JSON.stringify({
        name: data.name,
        status: type === 'test:pass' ? 'passed' :
          (error?.cause?.code === 'ERR_ASSERTION' || error?.code === 'ERR_ASSERTION' ? 'failed' : 'error'),
        detail: error ? String(error.stack || error.message || error) : '',
        skipped: Boolean(data.skip || data.todo),
      }) + '\n';
    }
  }
}
