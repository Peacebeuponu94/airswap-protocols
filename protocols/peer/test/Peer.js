const Peer = artifacts.require('Peer')
const Swap = artifacts.require('Swap')
const Types = artifacts.require('Types')
const FungibleToken = artifacts.require('FungibleToken')

const { emitted, reverted, equal, ok } = require('@airswap/test-utils').assert
const { balances } = require('@airswap/test-utils').balances
const {
  takeSnapshot,
  revertToSnapShot,
  getTimestampPlusDays,
  advanceTime,
} = require('@airswap/test-utils').time
const { orders } = require('@airswap/order-utils')
const {
  EMPTY_ADDRESS,
  SECONDS_IN_DAY,
} = require('@airswap/order-utils').constants

let snapshotId

contract('Peer', async accounts => {
  let aliceAddress = accounts[1]
  let bobAddress = accounts[2]
  let carolAddress = accounts[3]
  let aliceTradeWallet = accounts[4]

  let alicePeer

  let swapContract
  let swapAddress

  let tokenDAI
  let tokenWETH

  orders.setKnownAccounts([aliceAddress, bobAddress, carolAddress])

  before('Setup', async () => {
    let snapShot = await takeSnapshot()
    snapshotId = snapShot['result']
    // link types to swap
    await Swap.link(Types, (await Types.new()).address)
    // now deploy swap
    swapContract = await Swap.new()
    swapAddress = swapContract.address

    orders.setVerifyingContract(swapAddress)

    tokenWETH = await FungibleToken.new()
    tokenDAI = await FungibleToken.new()

    alicePeer = await Peer.new(swapAddress, aliceAddress, aliceTradeWallet, {
      from: aliceAddress,
    })
  })

  after(async () => {
    await revertToSnapShot(snapshotId)
  })

  describe('Checks setTradeWallet', async () => {
    it('Does not set a 0x0 trade wallet', async () => {
      await reverted(
        alicePeer.setTradeWallet(EMPTY_ADDRESS, { from: aliceAddress }),
        'TRADE_WALLET_REQUIRED'
      )
    })

    it('Does set a new valid trade wallet address', async () => {
      // set trade address to carol
      await alicePeer.setTradeWallet(carolAddress, { from: aliceAddress })

      // check it set
      let val = await alicePeer.tradeWallet.call()
      equal(val, carolAddress, 'trade wallet is incorrect')

      //change it back
      await alicePeer.setTradeWallet(aliceTradeWallet, { from: aliceAddress })
    })

    it('Non-owner cannot set a new address', async () => {
      await reverted(
        alicePeer.setTradeWallet(carolAddress, { from: carolAddress })
      )
    })
  })

  describe('Checks set and unset rule', async () => {
    it('Set and unset a rule for WETH/DAI', async () => {
      await alicePeer.setRule(
        tokenWETH.address,
        tokenDAI.address,
        100000,
        300,
        0,
        { from: aliceAddress }
      )
      equal(
        await alicePeer.getSignerSideQuote.call(
          1,
          tokenWETH.address,
          tokenDAI.address
        ),
        300
      )
      await alicePeer.unsetRule(tokenWETH.address, tokenDAI.address, {
        from: aliceAddress,
      })
      equal(
        await alicePeer.getSignerSideQuote.call(
          1,
          tokenWETH.address,
          tokenDAI.address
        ),
        0
      )
    })
  })

  describe('Checks pricing logic from the Peer', async () => {
    it('Send up to 100K WETH for DAI at 300 DAI/WETH', async () => {
      await alicePeer.setRule(
        tokenWETH.address,
        tokenDAI.address,
        100000,
        300,
        0,
        { from: aliceAddress }
      )
      equal(
        await alicePeer.getSignerSideQuote.call(
          1,
          tokenWETH.address,
          tokenDAI.address
        ),
        300
      )
    })

    it('Send up to 100K DAI for WETH at 0.0032 WETH/DAI', async () => {
      await alicePeer.setRule(
        tokenDAI.address,
        tokenWETH.address,
        100000,
        32,
        4,
        { from: aliceAddress }
      )
      equal(
        await alicePeer.getSignerSideQuote.call(
          100000,
          tokenDAI.address,
          tokenWETH.address
        ),
        320
      )
    })

    it('Send up to 100K WETH for DAI at 300.005 DAI/WETH', async () => {
      await alicePeer.setRule(
        tokenWETH.address,
        tokenDAI.address,
        100000,
        300005,
        3,
        { from: aliceAddress }
      )
      equal(
        await alicePeer.getSignerSideQuote.call(
          20000,
          tokenWETH.address,
          tokenDAI.address
        ),
        6000100
      )
      await alicePeer.unsetRule(tokenWETH.address, tokenDAI.address, {
        from: aliceAddress,
      })
    })
  })

  describe('Checks quotes from the Peer', async () => {
    before(
      'Adds a rule to send up to 100K DAI for WETH at 0.0032 WETH/DAI',
      async () => {
        emitted(
          await alicePeer.setRule(
            tokenDAI.address,
            tokenWETH.address,
            100000,
            32,
            4,
            { from: aliceAddress }
          ),
          'SetRule'
        )
      }
    )

    it('Gets a quote to buy 20K DAI for WETH (Quote: 64 WETH)', async () => {
      const quote = await alicePeer.getSignerSideQuote.call(
        20000,
        tokenDAI.address,
        tokenWETH.address
      )
      equal(quote, 64)
    })

    it('Gets a quote to sell 100K (Max) DAI for WETH (Quote: 320 WETH)', async () => {
      const quote = await alicePeer.getSignerSideQuote.call(
        100000,
        tokenDAI.address,
        tokenWETH.address
      )
      equal(quote, 320)
    })

    it('Gets a quote to sell 1 WETH for DAI (Quote: 300 DAI)', async () => {
      const quote = await alicePeer.getSenderSideQuote.call(
        1,
        tokenWETH.address,
        tokenDAI.address
      )
      equal(quote, 312)
    })

    it('Gets a quote to sell 500 DAI for WETH (False: No rule)', async () => {
      const quote = await alicePeer.getSenderSideQuote.call(
        500,
        tokenDAI.address,
        tokenWETH.address
      )
      equal(quote, 0)
    })

    it('Gets a max quote to buy WETH for DAI', async () => {
      const quote = await alicePeer.getMaxQuote.call(
        tokenDAI.address,
        tokenWETH.address
      )
      equal(quote[0], 100000)
      equal(quote[1], 320)
    })

    it('Gets a max quote for a non-existent rule', async () => {
      const quote = await alicePeer.getMaxQuote.call(
        tokenWETH.address,
        tokenDAI.address
      )
      equal(quote[0], 0)
      equal(quote[1], 0)
    })

    it('Gets a quote to buy WETH for 250000 DAI (False: Exceeds Max)', async () => {
      const quote = await alicePeer.getSignerSideQuote.call(
        250000,
        tokenDAI.address,
        tokenWETH.address
      )
      equal(quote, 0)
    })

    it('Gets a quote to buy 500 WETH for DAI (False: Exceeds Max)', async () => {
      const quote = await alicePeer.getSenderSideQuote.call(
        500,
        tokenWETH.address,
        tokenDAI.address
      )
      equal(quote, 0)
    })
  })

  describe('Test tradeWallet logic', async () => {
    let quote
    before('sets up rule and quote', async () => {
      // Peer will trade up to 100,000 DAI for WETH, at 200 DAI/WETH
      await alicePeer.setRule(
        tokenDAI.address, // Peer's token
        tokenWETH.address, // Signer's token
        100000,
        5,
        3,
        { from: aliceAddress }
      )
      // Signer wants to trade 1 WETH for x DAI
      quote = await alicePeer.getSenderSideQuote.call(
        1,
        tokenWETH.address,
        tokenDAI.address
      )
    })

    it('should not trade for a different wallet', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: carolAddress,
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'INVALID_SENDER_WALLET'
      )
    })

    it('should not accept open trades', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          // no wallet provided means wallet = address(0)
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'INVALID_SENDER_WALLET'
      )
    })

    it("should not trade if the tradeWallet hasn't authorized the peer", async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet, //correct trade wallet provided
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      // Succeeds on the Peer, fails on the Swap.
      // aliceTradeWallet hasn't authorized Peer to swap
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'SENDER_UNAUTHORIZED'
      )
    })

    it("should not trade if the tradeWallet's authorization has expired", async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet, //correct trade wallet provided
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      // authorize the peer
      let expiry = await getTimestampPlusDays(0.5)
      let tx = await swapContract.authorize(alicePeer.address, expiry, {
        from: aliceTradeWallet,
      })
      emitted(tx, 'Authorize')

      // increase time past expiry
      await advanceTime(SECONDS_IN_DAY * 0.6)

      // Succeeds on the Peer, fails on the Swap.
      // aliceTradeWallet approval has expired
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'SENDER_UNAUTHORIZED'
      )
    })

    it('should trade if the tradeWallet has authorized the peer', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet, //correct trade wallet provided
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      // tradeWallet needs DAI to trade
      emitted(await tokenDAI.mint(aliceTradeWallet, 300), 'Transfer')
      ok(
        await balances(aliceTradeWallet, [[tokenDAI, 300], [tokenWETH, 0]]),
        'Trade Wallet balances are incorrect'
      )

      // bob needs WETH to trade
      emitted(await tokenWETH.mint(bobAddress, 2), 'Transfer')
      ok(
        await balances(bobAddress, [[tokenDAI, 0], [tokenWETH, 2]]),
        'Bob balances are incorrect'
      )

      // aliceTradeWallet must authorize the Peer contract to swap
      let expiry = await getTimestampPlusDays(0.5)
      let tx = await swapContract.authorize(alicePeer.address, expiry, {
        from: aliceTradeWallet,
      })
      emitted(tx, 'Authorize')

      // both approve Swap to transfer tokens
      emitted(
        await tokenDAI.approve(swapAddress, 200, { from: aliceTradeWallet }),
        'Approval'
      )
      emitted(
        await tokenWETH.approve(swapAddress, 1, { from: bobAddress }),
        'Approval'
      )

      // Now the swap succeeds
      await alicePeer.provideOrder(order, { from: bobAddress })

      // remove authorization
      await swapContract.revoke(alicePeer.address, {
        from: aliceTradeWallet,
      })
    })
  })

  describe('Provide some orders to the Peer', async () => {
    let quote
    before('Gets a quote for 1 WETH', async () => {
      quote = await alicePeer.getSenderSideQuote.call(
        1,
        tokenWETH.address,
        tokenDAI.address
      )
    })

    it('Use quote with non-extent rule', async () => {
      // Note: Consumer is the order signer, Peer is the order sender.
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenDAI.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenDAI.address,
          param: 1,
        },
      })

      // Succeeds on the Peer, fails on the Swap.
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'TOKEN_PAIR_INACTIVE'
      )
    })

    it('Use quote with incorrect signer wallet', async () => {
      // Note: Consumer is the order signer, Peer is the order sender.
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      // Succeeds on the Peer, fails on the Swap.
      await reverted(
        alicePeer.provideOrder(order, { from: carolAddress }),
        'SIGNER_MUST_BE_SENDER'
      )
    })

    it('Use quote larger than peer rule', async () => {
      // Peer trades WETH for 100 DAI. Max trade is 2 WETH.
      await alicePeer.setRule(
        tokenWETH.address, // Peer's token
        tokenDAI.address, // Signer's token
        2,
        100,
        0,
        { from: aliceAddress }
      )
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenDAI.address,
          param: 300,
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenWETH.address,
          param: quote.toNumber(),
        },
      })

      // 300 DAI is 3 WETH, which is more than the max
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'AMOUNT_EXCEEDS_MAX'
      )
    })

    it('Use incorrect price on peer', async () => {
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenDAI.address,
          param: 500, //this is more than the peer rule would pay out
        },
      })

      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'PRICE_INCORRECT'
      )
    })

    it('Use quote with incorrect signer token kind', async () => {
      // Note: Consumer is the order signer, Peer is the order sender.
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
          kind: '0x80ac58cd',
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      // Succeeds on the Peer, fails on the Swap.
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'SIGNER_KIND_MUST_BE_ERC20'
      )
    })

    it('Use quote with incorrect sender token kind', async () => {
      // Note: Consumer is the order signer, Peer is the order sender.
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenDAI.address,
          param: quote.toNumber(),
          kind: '0x80ac58cd',
        },
      })

      // Succeeds on the Peer, fails on the Swap.
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'SENDER_KIND_MUST_BE_ERC20'
      )
    })

    it('Gets a quote to sell 1 WETH and takes it', async () => {
      // Note: Consumer is the order signer, Peer is the order sender.
      const order = await orders.getOrder({
        signer: {
          wallet: bobAddress,
          token: tokenWETH.address,
          param: 1,
        },
        sender: {
          wallet: aliceTradeWallet,
          token: tokenDAI.address,
          param: quote.toNumber(),
        },
      })

      // Succeeds on the Peer, fails on the Swap.
      await reverted(
        alicePeer.provideOrder(order, { from: bobAddress }),
        'SENDER_UNAUTHORIZED'
      )
    })
  })
})
