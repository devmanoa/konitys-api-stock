import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || '';
const RABBITMQ_HTTP_URL = process.env.RABBITMQ_HTTP_URL || '';
const RABBITMQ_VHOST = process.env.RABBITMQ_VHOST || '/';
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || 'platform.events';
const APP_NAME = process.env.APP_NAME || 'stock';

let connection: amqp.ChannelModel | null = null;
let channel: amqp.Channel | null = null;

export async function connect(): Promise<void> {
  if (!RABBITMQ_URL) {
    console.warn('[RabbitMQ] RABBITMQ_URL not set, skipping connection');
    return;
  }

  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  // Create a durable queue to capture all stock events
  const logQueue = `${APP_NAME}.events.log`;
  await channel.assertQueue(logQueue, { durable: true });
  await channel.bindQueue(logQueue, EXCHANGE, `${APP_NAME}.#`);

  console.log(`[RabbitMQ] Connected to ${RABBITMQ_URL.replace(/:([^:@]+)@/, ':****@')}`);
  console.log(`[RabbitMQ] Exchange: ${EXCHANGE} (topic, durable)`);
  console.log(`[RabbitMQ] Queue: ${logQueue} bound to ${APP_NAME}.#`);
  console.log(`[RabbitMQ] Publish mode: ${RABBITMQ_HTTP_URL ? 'HTTP Management API' : 'amqplib'}`);

  connection.on('error', (err: Error) => {
    console.error('[RabbitMQ] Connection error:', err.message);
  });

  connection.on('close', () => {
    console.warn('[RabbitMQ] Connection closed');
    channel = null;
    connection = null;
  });
}

interface Actor {
  id: string;
  email: string;
}

interface CrudEvent {
  id: string | number | null;
  table: string;
  action: 'inserted' | 'updated' | 'archived' | 'deleted';
  data: Record<string, any>;
  timestamp: string;
  actor: Actor | null;
}

export async function publishCrudEvent(
  table: string,
  action: CrudEvent['action'],
  data: Record<string, any>,
  actor: { id?: string; sub?: string; email?: string } | null = null
): Promise<CrudEvent | null> {
  if (!channel && !RABBITMQ_HTTP_URL) {
    console.warn(`[RabbitMQ] Channel not available: ${table}.${action}`);
    return null;
  }

  const event: CrudEvent = {
    id: data?.id || null,
    table,
    action,
    data,
    timestamp: new Date().toISOString(),
    actor: actor
      ? { id: actor.sub || actor.id || '', email: actor.email || '' }
      : null,
  };

  const fullRoutingKey = `${APP_NAME}.${table}.${action}`;

  if (RABBITMQ_HTTP_URL) {
    // Use HTTP Management API (amqplib publish is broken on Node.js 20 + Docker bridge)
    try {
      const url = new URL(RABBITMQ_HTTP_URL);
      const auth = Buffer.from(`${url.username}:${url.password}`).toString('base64');
      const apiBase = `${url.protocol}//${url.host}`;
      const vhost = encodeURIComponent(RABBITMQ_VHOST);

      const res = await fetch(`${apiBase}/api/exchanges/${vhost}/${encodeURIComponent(EXCHANGE)}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
        },
        body: JSON.stringify({
          properties: { delivery_mode: 2, content_type: 'application/json' },
          routing_key: fullRoutingKey,
          payload: JSON.stringify(event),
          payload_encoding: 'string',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[RabbitMQ] HTTP publish failed: ${res.status} ${res.statusText} - ${body}`);
      } else {
        const result = await res.json() as { routed: boolean };
        console.log(`[RabbitMQ] Published via HTTP: ${fullRoutingKey} (id=${event.id}, routed=${result.routed})`);
      }
    } catch (err: any) {
      console.error(`[RabbitMQ] HTTP publish error: ${err.message}`);
    }
  } else if (channel) {
    channel.publish(
      EXCHANGE,
      fullRoutingKey,
      Buffer.from(JSON.stringify(event)),
      { persistent: true, contentType: 'application/json' }
    );
    console.log(`[RabbitMQ] Published: ${fullRoutingKey} (id=${event.id})`);
  }

  return event;
}

type MessageHandler = (event: any, routingKey: string) => Promise<void>;

export async function subscribe(
  pattern: string,
  handler: MessageHandler,
  queueName?: string
): Promise<void> {
  if (!channel) {
    console.warn(`[RabbitMQ] Channel not available for subscribe: ${pattern}`);
    return;
  }

  const queue = queueName || `${APP_NAME}.${pattern}`;

  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, EXCHANGE, pattern);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;
      await handler(event, routingKey);
      channel!.ack(msg);
    } catch (error: any) {
      console.error(`[RabbitMQ] Error processing ${pattern}:`, error.message);
      channel!.nack(msg, false, false);
    }
  });
}

export async function close(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    console.log('[RabbitMQ] Connection closed gracefully');
  } catch (error: any) {
    console.error('[RabbitMQ] Error closing:', error.message);
  } finally {
    channel = null;
    connection = null;
  }
}

export default { connect, publishCrudEvent, subscribe, close };
