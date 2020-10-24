/**
 * Copyright © 2020 Atos Spain SA. All rights reserved.
 *
 * This file is part of `awrtc_signaling`.
 *
 * `awrtc_signaling` is free software: you can redistribute it and/or modify it
 * under the terms of BSD 3-Clause License.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT ANY WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT, IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE. See README file for the full disclaimer information and LICENSE
 * file for full license information in the project
 */

import WebSocket from 'ws'

import {ConnectionId, NetworkEvent, NetEventType} from './INetwork'


export class Client extends EventTarget
{
  constructor(ws)
  {
    super()

    if(!(ws instanceof WebSocket)) ws = new WebSocket(ws)

    ws.binaryType = 'arraybuffer'

    ws.addEventListener('close', this.#onClose, {once: true})
    ws.addEventListener('error', this.#onError)
    ws.addEventListener('message', this.#onMessage)
    ws.addEventListener('open', this.#onOpen, {once: true})

    this.#ws = ws
  }


  //
  // Public API
  //

  disconnect(connectionId: ConnectionId)
  {
    this.#send(NetEventType.Disconnected, connectionId)
  }

  getVersion()
  {
    if(this.#version == null)
    {
      this.#send(NetEventType.MetaVersion)

      this.#version = new Promise(resolve => this.#version_resolve = resolve)
    }

    return this.#version
  }

  heartbeat(NetEventType.MetaHeartbeat)
  {
    if(this.#heartbeat == null)
    {
      this.#send(NetEventType.MetaHeartbeat)

      this.#heartbeat = new Promise(resolve => this.#heartbeat_resolve = resolve)
    }

    return this.#heartbeat
  }

  newConnection(connectionId: ConnectionId, address: string)
  {
    this.#send(NetEventType.NewConnection, connectionId, address)
  }

  sendReliableMessage(connectionId: ConnectionId, messageData: Uint8Array)
  {
    this.#send(NetEventType.ReliableMessageReceived, connectionId, messageData)
  }

  sendUnreliableMessage(connectionId: ConnectionId, messageData: Uint8Array)
  {
    this.#send(NetEventType.UnreliableMessageReceived, connectionId, messageData)
  }

  serverClose()
  {
    this.#send(NetEventType.ServerClosed)
  }

  serverInitialize(address: string)
  {
    this.#send(NetEventType.ServerInitialized, null, address)
  }


  //
  // Private API
  //

  #heartbeat
  #heartbeat_resolve
  #version
  #version_resolve
  #ws

  #onClose = this.dispatchEvent.bind(this)
  #onError = this.dispatchEvent.bind(this)
  #onOpen  = this.dispatchEvent.bind(this)

  #onMessage = ({data}) =>
  {
    const networkEvent = NetworkEvent.fromByteArray(data)

    const type = networkEvent.Type
    switch(type)
    {
      case NetEventType.UnreliableMessageReceived:

      break

      case NetEventType.ReliableMessageReceived:

      break

      case NetEventType.ServerInitFailed:

      break

      case NetEventType.ServerClosed:

      break

      case NetEventType.NewConnection:

      break

      case NetEventType.ConnectionFailed:

      break

      case NetEventType.Disconnected:

      break

      case NetEventType.MetaVersion:
        const {RawData} = networkEvent

        if(!this.#version)
          this.#version = Promise.resolve(RawData)

        else if(this.#version_resolve)
        {
          this.#version_resolve(RawData)

          this.#version_resolve = null
        }

        else
        {
          const event = new Event('error')
          event.error = new Error(`Unexpected version message: '${RawData}'`)

          return this.dispatchEvent(event)
        }
      break

      case NetEventType.MetaHeartbeat:
        if(this.#heartbeat_resolve)
        {
          this.#heartbeat_resolve()

          this.#heartbeat = null
          this.#heartbeat_resolve = null
        }

        else
        {
          const msg = new Uint8Array(1);
          msg[0] = NetEventType.MetaHeartbeat;

          this.#ws.send(msg)
        }
        return

      default:
        const event = new Event('error')
        event.error = new Error(`Unexpected network message type: '${type}'`)

        return this.dispatchEvent(event)
    }

    const event = new Event(NetEventType[type])

    this.dispatchEvent(event)
  }

  #send(type: NetEventType, conId?: ConnectionId, data?: any)
  {
    this.#ws.send(NetworkEvent.toByteArray(new NetworkEvent(type, conId, data)))
  }
}
