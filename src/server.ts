import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import path from 'node:path'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import rateLimit from '@fastify/rate-limit'
import basicAuth from '@fastify/basic-auth'
import { PrismaClient } from '@prisma/client'
import { customAlphabet } from 'nanoid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = Fastify({ logger: true })
const prisma = new PrismaClient()
const generateSlug = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

async function start() {
  await app.register(rateLimit, { max: 60, timeWindow: '1 minute' })
  await app.register(multipart, {
    limits: {
      fileSize: 200 * 1024 * 1024
    }
  })
  await app.register(basicAuth, {
    validate: async (username: string, password: string) => {
      const expectedUser = process.env.ADMIN_USER ?? 'admin'
      const expectedPass = process.env.ADMIN_PASS ?? 'admin'
      if (username !== expectedUser || password !== expectedPass) {
        throw new Error('Invalid credentials')
      }
    }
  })
  await app.register(fastifyStatic, { root: path.join(__dirname, 'public'), prefix: '/public/' })

  app.get('/health', async () => ({ ok: true }))

  // Simple landing serving public index
  app.get('/', async (request, reply) => {
    // sendFile provided by @fastify/static
    // @ts-ignore
    reply.type('text/html')
    // @ts-ignore
    return reply.sendFile('index.html')
  })

  // Upload IPA endpoint
  app.post('/upload', async (request, reply) => {
    const file = await request.file()
    if (!file) {
      return reply.code(400).send({ error: 'No file uploaded' })
    }

    const originalFilename = file.filename ?? 'app.ipa'
    const lower = originalFilename.toLowerCase()
    if (!lower.endsWith('.ipa')) {
      return reply.code(400).send({ error: 'Only .ipa files are allowed' })
    }

    const uploadDir = path.join(__dirname, 'uploads')
    await fs.promises.mkdir(uploadDir, { recursive: true })
    const storageName = `${Date.now()}_${generateSlug()}.ipa`
    const storagePath = path.join(uploadDir, storageName)

    await pipeline(file.file, fs.createWriteStream(storagePath))
    const stat = await fs.promises.stat(storagePath)

    // Parse IPA metadata using app-info-parser (no types)
    let bundleId = 'unknown'
    let version = '0.0.0'
    let build = '0'
    try {
      // dynamic import to avoid type issues
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AppInfoParser = (await import('app-info-parser')).default as any
      const parser = new AppInfoParser(storagePath)
      const result = await parser.parse()
      bundleId = result?.CFBundleIdentifier ?? bundleId
      version = result?.CFBundleShortVersionString ?? version
      build = result?.CFBundleVersion ?? build
    } catch (err) {
      request.log.warn({ err }, 'Failed to parse IPA metadata')
    }

    const appBinary = await prisma.appBinary.create({
      data: {
        filename: originalFilename,
        storagePath,
        sizeBytes: stat.size as unknown as number,
        bundleId,
        version,
        build,
        signed: false
      }
    })

    const slug = generateSlug()
    const link = await prisma.link.create({
      data: {
        slug,
        appId: appBinary.id
      }
    })

    const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || 'localhost:3000'
    const proto = (request.headers['x-forwarded-proto'] as string) || 'http'
    const baseUrl = `${proto}://${host}`

    return reply.send({
      id: appBinary.id,
      slug: link.slug,
      bundleId,
      version,
      build,
      downloadIpaUrl: `${baseUrl}/ipa/${link.slug}`,
      // OTA will be added next step
      installUrl: `${baseUrl}/l/${link.slug}`
    })
  })

  // Download IPA by slug
  app.get('/ipa/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const link = await prisma.link.findUnique({ where: { slug }, include: { app: true } })
    if (!link) return reply.code(404).send({ error: 'Not found' })
    const filePath = link.app.storagePath
    try {
      await fs.promises.access(filePath, fs.constants.R_OK)
    } catch {
      return reply.code(404).send({ error: 'File missing' })
    }
    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Disposition', `attachment; filename="${link.app.filename}"`)
    // Record stat
    await prisma.stat.create({ data: { linkId: link.id, type: 'ipa_download', userAgent: request.headers['user-agent'] ?? null, ip: request.ip ?? null } })
    return reply.send(fs.createReadStream(filePath))
  })

  // Placeholder link landing (will become OTA page)
  app.get('/l/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const link = await prisma.link.findUnique({ where: { slug }, include: { app: true } })
    if (!link) return reply.code(404).send({ error: 'Not found' })
    const host = (request.headers['x-forwarded-host'] as string) || request.headers.host || 'localhost:3000'
    const proto = (request.headers['x-forwarded-proto'] as string) || 'http'
    const baseUrl = `${proto}://${host}`
    return reply.send({
      slug,
      app: {
        bundleId: link.app.bundleId,
        version: link.app.version,
        build: link.app.build
      },
      downloadIpaUrl: `${baseUrl}/ipa/${slug}`
    })
  })

  await app.listen({ port: 3000, host: '0.0.0.0' })
  console.log('Server running on http://localhost:3000')
}

start().catch((err) => { app.log.error(err); process.exit(1) })
