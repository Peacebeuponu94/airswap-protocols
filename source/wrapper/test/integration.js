const { expect } = require('chai')
const {
  orderERC20ToParams,
  createOrderERC20Signature,
  createOrderERC20,
} = require('@airswap/utils')
const { ethers, waffle } = require('hardhat')
const { deployMockContract } = waffle

const ERC20 = require('@openzeppelin/contracts/build/contracts/ERC20PresetMinterPauser.json')
const WETH9 = require('@uniswap/v2-periphery/build/WETH9.json')
const LIGHT = require('@airswap/swap-erc20/build/contracts/SwapERC20.sol/SwapERC20.json')
const { MAX_APPROVAL_AMOUNT } = require('../../../tools/constants')

describe('Wrapper Integration Tests', () => {
  let snapshotId
  let swap
  let wrapper

  let wethToken
  let signerToken
  let senderToken
  let stakingToken

  let deployer
  let sender
  let signer
  let protocolFeeWallet

  const CHAIN_ID = 31337
  const PROTOCOL_FEE = '30'
  const PROTOCOL_FEE_LIGHT = '7'
  const DEFAULT_AMOUNT = '10000'
  const DEFAULT_BALANCE = '100000'
  const REBATE_SCALE = '10'
  const REBATE_MAX = '100'

  async function createSignedOrder(params, signer) {
    const unsignedOrder = createOrderERC20({
      protocolFee: PROTOCOL_FEE,
      signerWallet: signer.address,
      signerToken: signerToken.address,
      signerAmount: DEFAULT_AMOUNT,
      senderWallet: sender.address,
      senderToken: senderToken.address,
      senderAmount: DEFAULT_AMOUNT,
      ...params,
    })
    return orderERC20ToParams({
      ...unsignedOrder,
      ...(await createOrderERC20Signature(
        unsignedOrder,
        signer,
        swap.address,
        CHAIN_ID
      )),
    })
  }

  beforeEach(async () => {
    snapshotId = await ethers.provider.send('evm_snapshot')
  })

  afterEach(async () => {
    await ethers.provider.send('evm_revert', [snapshotId])
  })

  before('get signers and deploy', async () => {
    ;[deployer, sender, signer, protocolFeeWallet] = await ethers.getSigners()

    signerToken = await (
      await ethers.getContractFactory(ERC20.abi, ERC20.bytecode)
    ).deploy('A', 'A')
    await signerToken.deployed()
    signerToken.mint(signer.address, DEFAULT_BALANCE)

    senderToken = await (
      await ethers.getContractFactory(ERC20.abi, ERC20.bytecode)
    ).deploy('B', 'B')
    await senderToken.deployed()
    senderToken.mint(sender.address, DEFAULT_BALANCE)

    wethToken = await (
      await ethers.getContractFactory(WETH9.abi, WETH9.bytecode)
    ).deploy()
    await wethToken.deployed()
    await wethToken.connect(signer).deposit({ value: DEFAULT_BALANCE })

    stakingToken = await deployMockContract(deployer, ERC20.abi)
    await stakingToken.mock.balanceOf.returns(0)

    swap = await (
      await ethers.getContractFactory(LIGHT.abi, LIGHT.bytecode)
    ).deploy(
      PROTOCOL_FEE,
      PROTOCOL_FEE_LIGHT,
      protocolFeeWallet.address,
      REBATE_SCALE,
      REBATE_MAX,
      stakingToken.address
    )
    await swap.deployed()

    await wethToken.connect(signer).approve(swap.address, DEFAULT_AMOUNT)

    wethToken.connect(signer).approve(swap.address, DEFAULT_BALANCE)
    signerToken.connect(signer).approve(swap.address, DEFAULT_BALANCE)
    senderToken.connect(sender).approve(swap.address, DEFAULT_BALANCE)

    wrapper = await (
      await ethers.getContractFactory('Wrapper')
    ).deploy(swap.address, wethToken.address)
    await wrapper.deployed()

    await senderToken
      .connect(sender)
      .approve(wrapper.address, MAX_APPROVAL_AMOUNT)
  })

  describe('Test wraps', async () => {
    it('test swap with approval succeeds', async () => {
      const order = await createSignedOrder(
        {
          senderWallet: wrapper.address,
        },
        signer
      )

      await expect(wrapper.connect(sender).swap(...order))
        .to.emit(swap, 'Swap')
        .to.emit(wrapper, 'WrappedSwapFor')
    })

    it('test that value is required', async () => {
      const order = await createSignedOrder(
        {
          senderToken: wethToken.address,
          senderWallet: wrapper.address,
        },
        signer
      )
      await expect(wrapper.connect(sender).swap(...order)).to.be.revertedWith(
        'VALUE_MUST_BE_SENT'
      )
    })

    it('test wrapped swap succeeds', async () => {
      const order = await createSignedOrder(
        {
          senderToken: wethToken.address,
          senderWallet: wrapper.address,
        },
        signer
      )
      await expect(
        wrapper.connect(sender).swap(...order, { value: DEFAULT_AMOUNT })
      )
        .to.emit(swap, 'Swap')
        .to.emit(wrapper, 'WrappedSwapFor')
    })

    it('test that token swaps have no value', async () => {
      const order = await createSignedOrder({}, signer)
      await senderToken.connect(sender).approve(wrapper.address, 10000)
      await expect(
        wrapper.connect(sender).swap(...order, { value: DEFAULT_AMOUNT })
      ).to.be.revertedWith('VALUE_MUST_BE_ZERO')
    })

    it('test that unwrap works', async () => {
      const order = await createSignedOrder(
        {
          signerToken: wethToken.address,
          senderWallet: wrapper.address,
          senderAmount: DEFAULT_AMOUNT,
        },
        signer
      )

      await expect(wrapper.connect(sender).swap(...order))
        .to.emit(swap, 'Swap')
        .to.emit(wrapper, 'WrappedSwapFor')
    })
  })
})
