const StoryblokClient = require('storyblok-js-client')
const Sync = require('./src/sync')
const getStoryParams = require('./src/getStoryParams')
const stringify = require('json-stringify-safe')

const log = (msg) => console.log(`[Storyblok] ${msg}`)

const logMemory = (label) => {
  const { heapUsed, heapTotal, rss } = process.memoryUsage()
  const mb = (b) => Math.round(b / 1024 / 1024)
  log(`memory [${label}] | heapUsed: ${mb(heapUsed)}MB | heapTotal: ${mb(heapTotal)}MB | rss: ${mb(rss)}MB`)
}

exports.sourceNodes = async function({ actions }, options) {
  const { createNode, setPluginStatus } = actions
  const client = new StoryblokClient(options)
  const tokenPreview = options.accessToken ? options.accessToken.slice(0, 8) + '...' : 'none'

  log(`sourceNodes starting | version: "${options.version || 'published'}" | token: ${tokenPreview}`)
  logMemory('sourceNodes start')

  Sync.init({
    createNode,
    setPluginStatus,
    client
  })

  const space = await Sync.getSpace()
  const languages = options.languages ? options.languages : space.language_codes
  languages.push('')

  log(`Languages to fetch: ${JSON.stringify(languages)}`)

  for (const language of languages) {
    log(`--- Starting language: "${language || 'default'}" ---`)
    await Sync.getAll('stories', {
      node: 'StoryblokEntry',
      params: getStoryParams(language, options),
      process: (item) => {
        for (var prop in item.content) {
          if (!item.content.hasOwnProperty(prop) || ['_editable', '_uid'].indexOf(prop) > -1) {
            continue;
          }
          const objectType = Object.prototype.toString.call(item.content[prop])
                                                      .replace('[object ', '')
                                                      .replace(']', '')
                                                      .toLowerCase()

          if (['number', 'boolean', 'string', 'object', 'array'].indexOf(objectType) === -1) {
            continue;
          }

          const type = prop == 'component' ? '' : ('_' + objectType)

          item['field_' + prop + type] = item.content[prop]
        }

        const contentStr = stringify(item.content)
        const contentSizeKb = Math.round(Buffer.byteLength(contentStr, 'utf8') / 1024)
        if (contentSizeKb > 100) {
          log(`⚠ Large story content: "${item.slug}" | ${contentSizeKb}kb | component: ${item.content && item.content.component}`)
        }

        item.content = contentStr
      }
    })
  }

  log(`Fetching tags...`)
  await Sync.getAll('tags', {
    node: 'StoryblokTag',
    params: getStoryParams('', options),
    process: (item) => {
      item.id = item.name
    }
  })

  if (options.includeLinks === true) {
    log(`Fetching links...`)
    await Sync.getAll('links', {
      node: 'StoryblokLink',
      params: getStoryParams('', options)
    })
  }

  log(`Fetching datasources...`)
  const datasources = await Sync.getAll('datasources', {
    node: 'StoryblokDatasource'
  })

  log(`Found ${datasources.length} datasource(s)`)

  for (const datasource of datasources) {
    const datasourceSlug = datasource.slug

    log(`Fetching entries for datasource: "${datasourceSlug}"`)
    await Sync.getAll('datasource_entries', {
      node: 'StoryblokDatasourceEntry',
      params: {
        datasource: datasourceSlug
      },
      process: (item) => {
        item.data_source_dimension = null
        item.data_source = datasourceSlug
      }
    })

    const datasourceDimensions = datasource.dimensions || []

    for (const dimension of datasourceDimensions) {
      log(`Fetching entries for datasource: "${datasourceSlug}" | dimension: "${dimension.entry_value}"`)
      await Sync.getAll('datasource_entries', {
        node: 'StoryblokDatasourceEntry',
        params: {
          datasource: datasourceSlug,
          dimension: dimension.entry_value
        },
        process: (item) => {
          item.data_source_dimension = dimension.entry_value
          item.data_source = datasourceSlug
        }
      })
    }
  }

  logMemory('sourceNodes end')
  log(`sourceNodes complete`)
}
