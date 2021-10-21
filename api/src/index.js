import { typeDefs } from './graphql-schema'
import { ApolloServer } from 'apollo-server-express'
import express from 'express'
import neo4j from 'neo4j-driver'
import { Neo4jGraphQL } from '@neo4j/graphql'
import dotenv from 'dotenv'

import jwt from 'jsonwebtoken'
import { compareSync, hashSync } from 'bcrypt'

// set environment variables from .env
dotenv.config()

const app = express()

/*
 * Create a Neo4j driver instance to connect to the database
 * using credentials specified as environment variables
 * with fallback to defaults
 */
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'neo4j'
  )
)

// resolvers

const resolvers = {
  Mutation: {
    signup: (obj, args, context) => {
      args.password = hashSync(args.password, 10)
      const session = context.driver.session()

      return session
        .run(
          `
        CREATE (u:User) SET u += $args, u.id = randomUUID()
        RETURN u`,
          { args }
        )
        .then((res) => {
          session.close()
          const { id, mail } = res.records[0].get('u').properties

          return {
            token: jwt.sign({ id, mail }, process.env.JWT_SECRET, {
              expiresIn: '30d',
            }),
          }
        })
    },
    login: (obj, args, context) => {
      const session = context.driver.session()

      return session
        .run(
          `
        MATCH (u:User {mail: $mail})
        RETURN u LIMIT 1 
        `,
          { mail: args.mail }
        )
        .then((res) => {
          session.close()
          const { id, mail, password } = res.records[0].get('u').properties
          if (!compareSync(args.password, password)) {
            // is this the same password ?
            throw new Error('Authorization Error')
          }
          return {
            token: jwt.sign({ id, mail }, process.env.JWT_SECRET, {
              expiresIn: '30d',
            }),
          }
        })
    },
  },
}

/*
 * Create an executable GraphQL schema object from GraphQL type definitions
 * including autogenerated queries and mutations.
 * Read more in the docs:
 * https://neo4j.com/docs/graphql-manual/current/
 */

const neoSchema = new Neo4jGraphQL({
  typeDefs,
  resolvers,
  driver,
  config: {
    jwt: {
      secret: process.env.JWT_SECRET,
    },
    database: process.env.NEO4J_DATABASE || 'neo4j',
  },
})

/*
 * Create a new ApolloServer instance, serving the GraphQL schema
 * created using makeAugmentedSchema above and injecting the Neo4j driver
 * instance into the context object so it is available in the
 * generated resolvers to connect to the database.
 */
const server = new ApolloServer({
  context: ({ req }) => ({ req }),
  schema: neoSchema.schema,
  introspection: true,
  playground: true,
})

// Specify host, port and path for GraphQL endpoint
const port = process.env.GRAPHQL_SERVER_PORT || 4001
const path = process.env.GRAPHQL_SERVER_PATH || '/graphql'
const host = process.env.GRAPHQL_SERVER_HOST || '0.0.0.0'

/*
 * Optionally, apply Express middleware for authentication, etc
 * This also also allows us to specify a path for the GraphQL endpoint
 */
server.applyMiddleware({ app, path })
app.listen({ host, port, path }, () => {
  console.log(`GraphQL server ready at http://${host}:${port}${path}`)
})
